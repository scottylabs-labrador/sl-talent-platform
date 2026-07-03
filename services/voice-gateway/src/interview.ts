// InterviewSession — the per-call orchestrator. Owns the six-section state
// machine, elapsed ticks, the consent gate, audio buffering + S3, transcript
// persistence, live moments, and end-of-call synthesis hand-off. Drives either
// the scripted SIMULATION (no Cartesia key, the demo default) or the REAL
// Cartesia + OpenRouter pipeline behind one identical WS protocol.

import type {
  ServerMsg,
  ServerEnded,
  ServerError,
  TranscriptWord,
} from '@tartan/types';
import type { AgentMessage } from '@tartan/agents';

import {
  CALL_BUDGET_MS,
  ELAPSED_TICK_MS,
  SIM_SECTION_SECONDS,
  VAD_SILENCE_MS,
  CARTESIA_USD_PER_MINUTE,
  isSimulation,
} from './config.js';
import { SECTIONS, SECTION_COUNT, sectionAt } from './sections.js';
import { SIM_SCRIPT } from './sim-script.js';
import {
  type CallSession,
  elapsedMs,
  consentSatisfied,
  saveSession,
  markResumable,
  deleteSession,
} from './session.js';
import {
  markScreenLive,
  persistTranscript,
  recordVerbalConsent,
  insertMoment,
  markProcessing,
  markStruck,
  setAudioKey,
  fileEscalation,
  logScreenCost,
  hasAppConsent,
  loadTranscript,
} from './store.js';
import { AudioUploader, s3Enabled } from './s3-audio.js';
import { enqueueSynthesis } from './queue.js';
import {
  CartesiaSttClient,
  cartesiaTts,
  toTranscriptWords,
  type SttWord,
} from './cartesia.js';
import { runRepTurn, sentenceChunks, type RepToolCall } from './rep-agent.js';
import { log } from './log.js';

/** Outgoing frame: the shared ServerMsg union, plus the `ready` frame carrying
 *  the `simulated` flag and the per-call `resumeToken` (rejoin credential —
 *  the signed call token is single-use and short-lived). */
export type Outgoing =
  | ServerMsg
  | { type: 'ready'; simulated: boolean; resumeToken: string };

export interface InterviewDeps {
  send: (msg: Outgoing) => void;
  /** Relay a raw TTS audio frame is done via `send` (ServerTtsChunk). */
  closeSocket: (code?: number) => void;
}

const AVG_WORD_MS = 340; // synthesized cadence for sim/rep transcript words

export class InterviewSession {
  private ended = false;
  private turnCounter = 0;
  private transcript: TranscriptWord[] = [];

  // timers
  private elapsedTimer: ReturnType<typeof setInterval> | undefined;
  private simTimers = new Set<ReturnType<typeof setTimeout>>();
  private sectionTimer: ReturnType<typeof setTimeout> | undefined;
  private budgetTimer: ReturnType<typeof setTimeout> | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;

  // audio + real pipeline
  private audioBuffer: Buffer[] = [];
  private audioBufferBytes = 0;
  private uploader: AudioUploader | undefined;
  private stt: CartesiaSttClient | undefined;
  private history: AgentMessage[] = [];
  private pendingStudentText = '';

  // cost accumulation (real mode)
  private llmTokens = 0;
  private llmCostUsd = 0;
  private lastModel = 'simulation';

  constructor(
    private session: CallSession,
    private readonly deps: InterviewDeps,
  ) {}

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Start (or, when resumed=true, resume within the 5-minute window). */
  async start(resumed: boolean): Promise<void> {
    this.deps.send({
      type: 'ready',
      simulated: this.session.simulated,
      resumeToken: this.session.resumeToken,
    });

    if (!resumed) {
      await markScreenLive(this.session.screenId);
    } else {
      // Rehydrate the already-persisted transcript so later persists append
      // to the full call rather than overwriting it with post-rejoin words.
      this.transcript = await loadTranscript(this.session.screenId);
      // A resumed session was frozen mid-pause conceptually; unfreeze cleanly.
      if (this.session.pausedAtEpoch !== null) {
        this.session.pausedMs += Date.now() - this.session.pausedAtEpoch;
        this.session.pausedAtEpoch = null;
        await saveSession(this.session);
      }
      // Restart recording on rejoin. stop() aborts the in-flight multipart and
      // clears session.recording; without this, a session that already passed
      // both consent gates would never record again after a rejoin and the
      // final end_call would produce a null audioKey. The pre-drop span's raw
      // audio is lost (documented limitation); post-rejoin audio is captured
      // into a fresh object at the same key.
      if (consentSatisfied(this.session)) {
        await this.maybeStartRecording();
      }
    }

    // Announce the current section + elapsed immediately so a resumed client
    // rehydrates its UI.
    this.emitSection(this.session.sectionIndex);
    this.deps.send({ type: 'elapsed', ms: elapsedMs(this.session) });

    this.startElapsedTicks();
    this.armBudget();

    if (this.session.simulated) {
      // On resume, skip re-running the current section's scripted events —
      // they already fired before the drop (re-running would duplicate
      // moments and captions). Only the section-boundary timer is re-armed.
      this.enterSimSection(this.session.sectionIndex, { skipEvents: resumed });
    } else {
      this.startRealPipeline();
    }
  }

  private startElapsedTicks(): void {
    this.elapsedTimer = setInterval(() => {
      if (this.ended) return;
      this.deps.send({ type: 'elapsed', ms: elapsedMs(this.session) });
    }, ELAPSED_TICK_MS);
  }

  private armBudget(): void {
    const remaining = Math.max(0, CALL_BUDGET_MS - elapsedMs(this.session));
    this.budgetTimer = setTimeout(() => {
      void this.end('incomplete_timeout');
    }, remaining);
  }

  private clearTimers(): void {
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    if (this.sectionTimer) clearTimeout(this.sectionTimer);
    if (this.budgetTimer) clearTimeout(this.budgetTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    for (const t of this.simTimers) clearTimeout(t);
    this.simTimers.clear();
    this.elapsedTimer = undefined;
    this.sectionTimer = undefined;
    this.budgetTimer = undefined;
    this.silenceTimer = undefined;
  }

  // ── section state machine ────────────────────────────────────────────────────

  private emitSection(index: number): void {
    const def = sectionAt(index);
    if (!def) return;
    this.deps.send({
      type: 'section',
      index: def.index,
      name: def.name,
      startedAtMs: elapsedMs(this.session),
    });
  }

  private async advanceSection(): Promise<void> {
    const next = this.session.sectionIndex + 1;
    if (next >= SECTION_COUNT) {
      await this.end('completed');
      return;
    }
    this.session.sectionIndex = next;
    await saveSession(this.session);
    this.emitSection(next);
    if (this.session.simulated) this.enterSimSection(next);
  }

  // ── simulation driver ────────────────────────────────────────────────────────

  private enterSimSection(
    index: number,
    opts: { skipEvents?: boolean } = {},
  ): void {
    if (this.ended) return;
    const script = SIM_SCRIPT[index];
    const durationMs = SIM_SECTION_SECONDS * 1000;
    if (script && !opts.skipEvents) {
      for (const ev of script.events) {
        const delay = Math.max(0, Math.min(1, ev.at)) * durationMs;
        const handle = setTimeout(() => {
          this.simTimers.delete(handle);
          void this.runSimEvent(ev);
        }, delay);
        this.simTimers.add(handle);
      }
    }
    // Advance to the next section (or end) at the section boundary.
    this.sectionTimer = setTimeout(() => {
      void this.advanceSection();
    }, durationMs);
  }

  private async runSimEvent(
    ev: (typeof SIM_SCRIPT)[number]['events'][number],
  ): Promise<void> {
    if (this.ended) return;
    switch (ev.kind) {
      case 'caption':
        this.emitFinalCaption(ev.speaker, ev.text);
        break;
      case 'consent':
        await this.confirmVerbalConsent();
        break;
      case 'moment':
        await this.markMoment(ev.tag, ev.quote, ev.note);
        break;
      case 'escalation':
        await this.escalate(ev.reason);
        break;
    }
  }

  // ── captions + transcript ────────────────────────────────────────────────────

  private nextTurnId(): string {
    this.turnCounter += 1;
    return `t${this.turnCounter}`;
  }

  /** Emit a final caption, append synthesized word timestamps, persist. */
  private emitFinalCaption(speaker: 'rep' | 'student', text: string): void {
    const turnId = this.nextTurnId();
    // Emit a brief partial first for realism, then the final.
    this.deps.send({ type: 'caption', turnId, speaker, text, partial: true });
    this.deps.send({ type: 'caption', turnId, speaker, text, partial: false });
    this.appendWords(this.synthWords(text, speaker));
    if (speaker === 'student') this.history.push({ role: 'user', content: text });
    else this.history.push({ role: 'assistant', content: text });
    void this.persist();
  }

  private synthWords(text: string, speaker: 'rep' | 'student'): TranscriptWord[] {
    const start = elapsedMs(this.session);
    const tokens = text.split(/\s+/).filter(Boolean);
    return tokens.map((word, i) => ({
      word,
      t0: start + i * AVG_WORD_MS,
      t1: start + (i + 1) * AVG_WORD_MS,
      speaker,
    }));
  }

  private appendWords(words: TranscriptWord[]): void {
    this.transcript.push(...words);
    this.session.transcriptCursor = this.transcript.length;
  }

  private async persist(): Promise<void> {
    // Compliance gate: nothing reaches durable storage until BOTH consent
    // halves are satisfied. Pre-consent words live only in this process's
    // memory; maybeStartRecording() flushes the backlog once consent lands,
    // and a declined call drops it with the audio buffers.
    if (!consentSatisfied(this.session)) return;
    await persistTranscript(this.session.screenId, this.transcript);
  }

  // ── tools (shared by sim events and the real Rep) ────────────────────────────

  private async confirmVerbalConsent(): Promise<void> {
    if (this.session.consentVerbal) return;
    const now = elapsedMs(this.session);
    this.session.consentVerbal = true;
    await saveSession(this.session);
    await recordVerbalConsent(this.session.screenId, {
      t0: Math.max(0, now - 4000),
      t1: now,
    });
    this.deps.send({ type: 'consent_ack' });
    await this.maybeStartRecording();
  }

  private async markMoment(tag: string, quote: string, note?: string): Promise<void> {
    const now = elapsedMs(this.session);
    await insertMoment(this.session.screenId, {
      tStartMs: now,
      tEndMs: now + 8000,
      tag,
      quote,
      repNote: note,
    });
    this.deps.send({ type: 'moment_marked', tag, note });
  }

  private async escalate(reason: string): Promise<void> {
    await fileEscalation(this.session.screenId, this.session.studentId, reason);
    if (reason.toLowerCase().includes('consent')) {
      await this.end('consent_declined');
    }
  }

  private async applyRepTool(tool: RepToolCall): Promise<void> {
    switch (tool.name) {
      case 'advance_section':
        await this.advanceSection();
        break;
      case 'mark_moment':
        await this.markMoment(tool.tag, this.pendingStudentText || tool.tag, tool.note);
        break;
      case 'confirm_verbal_consent':
        await this.confirmVerbalConsent();
        break;
      case 'flag_escalation':
        await this.escalate(tool.reason);
        break;
    }
  }

  // ── consent gate + audio storage ─────────────────────────────────────────────

  /** Called when either consent gate flips; starts S3 once BOTH are satisfied. */
  private async maybeStartRecording(): Promise<void> {
    if (this.session.recording) return;
    if (!consentSatisfied(this.session)) return;
    // Consent just became fully satisfied: flush the in-memory transcript
    // backlog that persist() was withholding pre-consent.
    void this.persist();
    if (!s3Enabled()) {
      // Consent is satisfied but S3 is not configured (laptop demo): mark the
      // session recording so we do not re-check, but keep audio in memory only.
      this.session.recording = true;
      await saveSession(this.session);
      return;
    }
    this.uploader = new AudioUploader(this.session.screenId);
    await this.uploader.begin();
    // Flush everything buffered pre-consent, then stream going forward.
    for (const chunk of this.audioBuffer) await this.uploader.write(chunk);
    this.audioBuffer = [];
    this.audioBufferBytes = 0;
    this.session.recording = true;
    await saveSession(this.session);
  }

  /** Inbound 16kHz PCM16 from the browser (binary frame or ClientAudio). */
  handleAudio(pcm: Buffer): void {
    if (this.ended) return;
    if (this.session.pausedAtEpoch !== null) return; // ignore audio while paused

    // Real pipeline: transcription may run pre-consent (in-memory only); only
    // S3 STORAGE is consent-gated.
    if (!this.session.simulated && this.stt) this.stt.sendAudio(pcm);

    if (this.session.recording && this.uploader) {
      void this.uploader.write(pcm);
    } else if (!this.session.recording) {
      // Buffer in memory until consent (cap to avoid unbounded growth).
      if (this.audioBufferBytes < 32_000 * 60 * 3) {
        this.audioBuffer.push(pcm);
        this.audioBufferBytes += pcm.length;
      }
    }
  }

  // ── real pipeline (Cartesia + OpenRouter) ────────────────────────────────────

  private startRealPipeline(): void {
    this.stt = new CartesiaSttClient({
      onPartial: (text) => {
        if (this.ended) return;
        this.deps.send({
          type: 'caption',
          turnId: `live-${this.turnCounter + 1}`,
          speaker: 'student',
          text,
          partial: true,
        });
      },
      onFinal: (text, words) => this.onStudentFinal(text, words),
      onError: (e) => {
        log.error('stt error', e);
        this.deps.send({ type: 'error', code: 'stt_failure', message: 'transcription error' });
      },
    });
    this.stt.connect();
  }

  private onStudentFinal(text: string, words: SttWord[]): void {
    if (this.ended || !text.trim()) return;
    const turnId = this.nextTurnId();
    this.deps.send({ type: 'caption', turnId, speaker: 'student', text, partial: false });
    this.appendWords(toTranscriptWords(words, 'student'));
    void this.persist();
    this.pendingStudentText = text;
    this.history.push({ role: 'user', content: text });

    // End-of-turn debounce, then run the Rep.
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      void this.runRep();
    }, VAD_SILENCE_MS);
  }

  private async runRep(): Promise<void> {
    if (this.ended) return;
    const def = sectionAt(this.session.sectionIndex) ?? SECTIONS[0]!;
    let turn;
    try {
      turn = await runRepTurn({
        history: this.history,
        sectionName: def.name,
        sectionIndex: this.session.sectionIndex,
        elapsedMs: elapsedMs(this.session),
        consentConfirmed: this.session.consentVerbal,
        screenId: this.session.screenId,
      });
    } catch (e) {
      log.error('rep turn failed', e);
      this.deps.send({ type: 'error', code: 'llm_failure', message: 'interviewer error' });
      return;
    }

    this.lastModel = turn.model;
    this.llmTokens += turn.usage.totalTokens ?? 0;
    this.llmCostUsd += turn.usage.costUsd ?? 0;

    const turnId = this.nextTurnId();
    this.deps.send({ type: 'caption', turnId, speaker: 'rep', text: turn.reply, partial: false });
    this.appendWords(this.synthWords(turn.reply, 'rep'));
    this.history.push({ role: 'assistant', content: turn.reply });
    void this.persist();

    this.speak(turn.reply, turnId);

    for (const tool of turn.tools) await this.applyRepTool(tool);
  }

  /** Sentence-chunk the reply into Cartesia Sonic, relaying tts_chunk frames. */
  private speak(reply: string, turnId: string): void {
    const chunks = sentenceChunks(reply);
    let seq = 0;
    let idx = 0;
    const speakNext = (): void => {
      if (this.ended || idx >= chunks.length) {
        this.deps.send({ type: 'tts_end', turnId });
        return;
      }
      const text = chunks[idx]!;
      idx += 1;
      cartesiaTts(
        text,
        turnId,
        {
          onChunk: (audio) => {
            seq += 1;
            this.deps.send({ type: 'tts_chunk', seq, audio });
          },
          onDone: () => speakNext(),
          onError: (e) => {
            log.error('tts error', e);
            this.deps.send({ type: 'error', code: 'tts_failure', message: 'voice synthesis error' });
            speakNext();
          },
        },
        // Each sentence chunk opens its own one-shot Cartesia socket, so
        // context-continuation (which only spans a single connection) does not
        // apply. Sending `continue: true` on a standalone socket makes Cartesia
        // hold the context open and never emit `done`, stalling the turn after
        // the first sentence. Always finalize per socket.
        { continue: false },
      );
    };
    speakNext();
  }

  // ── client control messages ──────────────────────────────────────────────────

  async onConsentConfirmed(): Promise<void> {
    // The in-app consent gate. The client message is a hint only — the gate
    // flips on the DB consents row written by startCall for THIS screen, so a
    // spoofed frame can never open the recording gate.
    const inDb = await hasAppConsent(this.session.studentId, this.session.screenId);
    if (!inDb) {
      log.info('consent_confirmed frame without a DB consents row; ignored', {
        screenId: this.session.screenId,
      });
      return;
    }
    this.session.consentApp = true;
    await saveSession(this.session);
    await this.maybeStartRecording();
  }

  async onPause(): Promise<void> {
    if (this.session.pausedAtEpoch !== null) return;
    this.session.pausedAtEpoch = Date.now();
    // Freeze the call budget with the clock: elapsed stops accruing while
    // paused, so the wall-clock timeout must stop counting too.
    if (this.budgetTimer) {
      clearTimeout(this.budgetTimer);
      this.budgetTimer = undefined;
    }
    await saveSession(this.session);
  }

  async onResume(): Promise<void> {
    if (this.session.pausedAtEpoch === null) return;
    this.session.pausedMs += Date.now() - this.session.pausedAtEpoch;
    this.session.pausedAtEpoch = null;
    this.armBudget();
    await saveSession(this.session);
  }

  // ── end + teardown ───────────────────────────────────────────────────────────

  async end(reason: ServerEnded['reason']): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.clearTimers();
    this.stt?.close();

    const consented = consentSatisfied(this.session);

    if (!consented || reason === 'consent_declined') {
      // Compliance: drop buffers, abort any upload, mark the screen struck.
      this.audioBuffer = [];
      this.audioBufferBytes = 0;
      if (this.uploader) await this.uploader.abort();
      await markStruck(this.session.screenId);
      this.session.status = 'ended';
      await saveSession(this.session);
      await deleteSession(this.session.screenId);
      this.deps.send({ type: 'ended', reason });
      this.deps.closeSocket(1000);
      log.info('call ended pre-consent (struck)', { screenId: this.session.screenId, reason });
      return;
    }

    // Consented: finalize audio, persist, hand off to synthesis.
    let audioKey: string | null = null;
    if (this.uploader) {
      audioKey = await this.uploader.finish();
      if (audioKey) await setAudioKey(this.session.screenId, audioKey);
    }
    await markProcessing(this.session.screenId, this.transcript);
    await this.logCost();
    await enqueueSynthesis(this.session.screenId);

    this.session.status = 'ended';
    await saveSession(this.session);
    await deleteSession(this.session.screenId);
    this.deps.send({ type: 'ended', reason });
    this.deps.closeSocket(1000);
    log.info('call ended', { screenId: this.session.screenId, reason, audioKey });
  }

  private async logCost(): Promise<void> {
    const minutes = elapsedMs(this.session) / 60_000;
    await logScreenCost({
      screenId: this.session.screenId,
      model: this.lastModel,
      cartesiaMinutes: minutes,
      cartesiaCostUsd: this.session.simulated ? 0 : minutes * CARTESIA_USD_PER_MINUTE,
      llmTokens: this.llmTokens,
      llmCostUsd: this.llmCostUsd,
      simulated: this.session.simulated,
    });
  }

  /** Socket dropped without an explicit end: freeze for the 5-min rejoin. */
  async stop(): Promise<void> {
    if (this.ended) return;
    this.clearTimers();
    this.stt?.close();
    // Aborting the in-flight multipart loses the raw audio for the pre-drop span
    // (transcript + moments already persisted survive). Recording restarts on
    // rejoin. Documented limitation.
    if (this.uploader) {
      await this.uploader.abort();
      this.uploader = undefined;
      this.session.recording = false;
    }
    await saveSession(this.session);
    // Shorten the Redis TTL to the 5-minute rejoin window; the resume token
    // in the client's ready frame reconnects into this frozen state.
    await markResumable(this.session.screenId);
  }

  sendError(code: ServerError['code'], message: string): void {
    this.deps.send({ type: 'error', code, message });
  }
}

// Re-export for the connection layer.
export { isSimulation };
