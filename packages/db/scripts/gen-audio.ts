// DEMO AUDIO generator (macOS only — uses `say`). Run from repo root with env
// loaded, e.g.:
//   set -a && source .env && set +a && \
//     pnpm --filter @tartan/db exec tsx scripts/gen-audio.ts
//
// For each of June Park's three screen moments (which serve BOTH the sponsor
// dossier Screen tab and the student post-call review — June is one person with
// one voice) it:
//   1. writes the spoken text to a temp file and synthesizes it with `say`
//      using a natural voice (Samantha), one voice per person,
//   2. converts to mp3 44.1kHz mono with ffmpeg,
//   3. measures the real duration with ffprobe,
//   4. uploads to s3://tartan-talent-audio-dev AND s3://tartan-talent-audio-prod
//      at clips/{moment_id}.mp3,
// then synthesizes a ~40s "full call" stand-in and uploads raw/{screen_id}.ogg
// (opus) to both buckets. Finally it writes scripts/audio-manifest.json, which
// seed.ts reads to stamp real durations + clip keys onto the moment rows, and
// cleans up all temp files.
//
// The manifest is the ONLY output the seed depends on; if the audio pipeline is
// unavailable, seed.ts falls back to the design's nominal clip durations.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUNE_MOMENTS, JUNE_SCREEN_ID } from '../src/seed.js';

const BUCKETS = ['tartan-talent-audio-dev', 'tartan-talent-audio-prod'] as const;
const here = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(here, 'audio-manifest.json');

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function durationMs(file: string): number {
  const out = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]).trim();
  return Math.round(parseFloat(out) * 1000);
}

function upload(localFile: string, key: string): void {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  for (const bucket of BUCKETS) {
    const args = ['s3', 'cp', localFile, `s3://${bucket}/${key}`];
    if (region) args.push('--region', region);
    try {
      run('aws', args);
      // eslint-disable-next-line no-console
      console.log(`  uploaded s3://${bucket}/${key}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`  UPLOAD FAILED s3://${bucket}/${key}:`, (err as Error).message);
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'tartan-audio-'));
  const manifest: {
    moments: Record<string, { durationMs: number; clipKey: string }>;
    screens: Record<string, { audioKey: string }>;
  } = { moments: {}, screens: {} };

  try {
    for (const m of JUNE_MOMENTS) {
      // eslint-disable-next-line no-console
      console.log(`Moment ${m.tag} (${m.id}) — voice ${m.voice}`);
      const txt = join(work, `${m.id}.txt`);
      const aiff = join(work, `${m.id}.aiff`);
      const mp3 = join(work, `${m.id}.mp3`);
      writeFileSync(txt, m.text, 'utf8');
      run('say', ['-v', m.voice, '-f', txt, '-o', aiff]);
      run('ffmpeg', ['-y', '-i', aiff, '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '4', mp3]);
      const dur = durationMs(mp3);
      const key = `clips/${m.id}.mp3`;
      upload(mp3, key);
      manifest.moments[m.id] = { durationMs: dur, clipKey: key };
      // eslint-disable-next-line no-console
      console.log(`  measured ${dur} ms`);
    }

    // Full-call stand-in (~40s): a plain narration stitched from the three clip
    // texts, bookended by consent + wrap lines so it reads like a screen.
    // eslint-disable-next-line no-console
    console.log(`Full call stand-in for screen ${JUNE_SCREEN_ID}`);
    const narration = [
      'Consent confirmed, on the record. Let us go deeper on the fifteen four forty project.',
      JUNE_MOMENTS[0]!.text,
      JUNE_MOMENTS[1]!.text,
      JUNE_MOMENTS[2]!.text,
      'If I rebuilt it today, I would model the state machine in T L A plus first. That is a good place to wrap. Thanks for walking me through it.',
    ].join(' ');
    const fullTxt = join(work, 'fullcall.txt');
    const fullAiff = join(work, 'fullcall.aiff');
    const ogg = join(work, 'fullcall.ogg');
    writeFileSync(fullTxt, narration, 'utf8');
    run('say', ['-v', JUNE_MOMENTS[0]!.voice, '-f', fullTxt, '-o', fullAiff]);
    run('ffmpeg', ['-y', '-i', fullAiff, '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', ogg]);
    const oggKey = `raw/${JUNE_SCREEN_ID}.ogg`;
    upload(ogg, oggKey);
    manifest.screens[JUNE_SCREEN_ID] = { audioKey: oggKey };
    // eslint-disable-next-line no-console
    console.log(`  full call ${durationMs(ogg)} ms`);

    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\nWrote ${MANIFEST_PATH}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Audio generation failed:', err);
  process.exit(1);
});
