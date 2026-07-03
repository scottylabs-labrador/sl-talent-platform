'use client';

// The self-serve student onboarding wizard. A focused, tab-bar-free flow in the
// 390px student column: welcome → visibility → logistics → author → review, then
// "finish and go live". Reads/writes the editable Living Profile over tRPC.
//
// Trust grammar: everything authored here lands self-reported/pending and stays
// verified=false — the verification worker is the only thing that can promote
// it. A brand-new profile without a published screen is (correctly) not yet in
// sponsor results; onboarding just builds the profile.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  EvidenceType,
  OnboardingStep,
  StudentKind,
  Visibility,
  WorkAuthStatus,
} from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { BrandGlyph, Pill, useToast } from '@/components/ui';
import { slugify } from '@/lib/resume';
import s from '../onboarding.module.css';

type WizardStep = 'welcome' | 'visibility' | 'logistics' | 'author' | 'review';
const STEP_ORDER: WizardStep[] = ['welcome', 'visibility', 'logistics', 'author', 'review'];

const VIS_OPTIONS: { id: Visibility; title: string; display: string; desc: string }[] = [
  {
    id: 'searchable',
    title: 'Searchable',
    display: 'searchable',
    desc: 'All 10 Premier sponsors can find you. Every view is logged here.',
  },
  {
    id: 'match_only',
    title: 'Match only',
    display: 'match-only',
    desc: 'Invisible until shortlisted, then we ask you before revealing identity.',
  },
  {
    id: 'paused',
    title: 'Paused',
    display: 'paused',
    desc: 'Nothing new is shown to anyone. Existing intros stay open.',
  },
];

const KIND_OPTIONS: { id: StudentKind; label: string }[] = [
  { id: 'undergrad', label: 'Undergrad' },
  { id: 'grad', label: 'Grad' },
  { id: 'alum', label: 'Alum' },
];

const WORK_AUTH_OPTIONS: { id: WorkAuthStatus; label: string }[] = [
  { id: 'citizen', label: 'US citizen' },
  { id: 'permanent_resident', label: 'Permanent resident' },
  { id: 'f1_opt', label: 'F-1 · OPT eligible' },
  { id: 'f1_cpt', label: 'F-1 · CPT eligible' },
  { id: 'h1b_needed', label: 'H-1B sponsorship needed' },
  { id: 'other', label: 'Other / prefer not to say' },
];

// interview_moment evidence is minted by the Rep during a screen, never by hand.
const EVIDENCE_TYPES: { id: EvidenceType; label: string }[] = [
  { id: 'repo', label: 'Repo' },
  { id: 'paper', label: 'Paper' },
  { id: 'demo', label: 'Demo' },
  { id: 'hackathon', label: 'Hackathon' },
  { id: 'course', label: 'Course' },
  { id: 'work', label: 'Work' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toWizardStep(step: OnboardingStep): WizardStep {
  // Server steps omit 'visibility'; map the resume hint onto the client flow.
  if (step === 'author') return 'author';
  if (step === 'review' || step === 'done') return 'review';
  if (step === 'logistics') return 'logistics';
  return 'welcome';
}

export function OnboardingWizard({ initialStep }: { initialStep: OnboardingStep }) {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const stateQuery = trpc.student.onboardingState.useQuery();
  const profile = stateQuery.data?.profile;

  const [step, setStep] = useState<WizardStep>(() => toWizardStep(initialStep));

  // Mutations. The authoring mutations (upsert*/delete*) are owned by the
  // profile-edit surface and reused here by name.
  const updateVisibility = trpc.student.updateVisibility.useMutation();
  const setLogistics = trpc.student.setLogistics.useMutation();
  const parseResumeM = trpc.student.parseResume.useMutation();
  const completeOnboarding = trpc.student.completeOnboarding.useMutation();
  const upsertSkill = trpc.student.upsertSkillClaim.useMutation();
  const removeSkill = trpc.student.removeSkillBySkillId.useMutation();
  const upsertStory = trpc.student.upsertStory.useMutation();
  const deleteStory = trpc.student.deleteStory.useMutation();
  const addEvidence = trpc.student.addEvidence.useMutation();
  const deleteEvidence = trpc.student.deleteEvidence.useMutation();

  const refresh = () => {
    void utils.student.onboardingState.invalidate();
    void utils.student.profile.invalidate();
  };

  const index = STEP_ORDER.indexOf(step);
  const progress = (index / (STEP_ORDER.length - 1)) * 100;
  const goBack = () => setStep(STEP_ORDER[Math.max(0, index - 1)]!);
  const goNext = () => setStep(STEP_ORDER[Math.min(STEP_ORDER.length - 1, index + 1)]!);

  // ── Visibility ──────────────────────────────────────────────────────────
  const [visibility, setVisibility] = useState<Visibility>('searchable');
  const visSeeded = useRef(false);

  // ── Logistics local form ─────────────────────────────────────────────────
  const [program, setProgram] = useState('');
  const [gradMonth, setGradMonth] = useState(''); // '01'..'12'
  const [gradYear, setGradYear] = useState('');
  const [kind, setKind] = useState<StudentKind>('undergrad');
  const [workAuthStatus, setWorkAuthStatus] = useState<WorkAuthStatus | ''>('');
  const [locations, setLocations] = useState<string[]>([]);
  const [locInput, setLocInput] = useState('');
  const [compMin, setCompMin] = useState('');
  const [compMax, setCompMax] = useState('');
  const [compHourly, setCompHourly] = useState(false);
  const [startupOpen, setStartupOpen] = useState(false);
  const logSeeded = useRef(false);

  useEffect(() => {
    if (!profile) return;
    if (!visSeeded.current) {
      visSeeded.current = true;
      setVisibility(profile.visibility);
    }
    if (!logSeeded.current) {
      logSeeded.current = true;
      setProgram(profile.program ?? '');
      setKind(profile.kind);
      if (profile.gradDateISO) {
        const d = new Date(profile.gradDateISO);
        setGradMonth(String(d.getUTCMonth() + 1).padStart(2, '0'));
        setGradYear(String(d.getUTCFullYear()));
      }
      setWorkAuthStatus(profile.workAuth?.status ?? '');
      setLocations(profile.locations ?? []);
      setCompMin(profile.compExpectation?.min != null ? String(profile.compExpectation.min) : '');
      setCompMax(profile.compExpectation?.max != null ? String(profile.compExpectation.max) : '');
      setCompHourly(Boolean(profile.compExpectation?.hourly));
      setStartupOpen(profile.startupOpen);
    }
  }, [profile]);

  const years = useMemo(() => {
    const now = new Date().getUTCFullYear();
    return Array.from({ length: 8 }, (_, i) => String(now + i));
  }, []);

  const pickVisibility = (opt: (typeof VIS_OPTIONS)[number]) => {
    setVisibility(opt.id);
    updateVisibility.mutate(
      { visibility: opt.id },
      { onSuccess: () => refresh() },
    );
    toast(`Visibility set to ${opt.display}. Effective now, including the MCP layer.`, {
      durationMs: 2600,
    });
  };

  const addLocation = () => {
    const v = locInput.trim();
    if (!v) return;
    if (!locations.includes(v)) setLocations((xs) => [...xs, v]);
    setLocInput('');
  };

  const saveLogistics = async (): Promise<boolean> => {
    const payload: Parameters<typeof setLogistics.mutateAsync>[0] = {
      program: program.trim() || undefined,
      kind,
      locations,
      startupOpen,
    };
    if (gradYear && gradMonth) payload.gradDateISO = `${gradYear}-${gradMonth}-01`;
    if (workAuthStatus) {
      payload.workAuth = {
        status: workAuthStatus,
        needsSponsorship: workAuthStatus === 'h1b_needed',
      };
    }
    const min = compMin ? Number(compMin) : undefined;
    const max = compMax ? Number(compMax) : undefined;
    if (min != null || max != null) {
      payload.compExpectation = {
        min: min != null && !Number.isNaN(min) ? min : undefined,
        max: max != null && !Number.isNaN(max) ? max : undefined,
        hourly: compHourly,
        currency: 'USD',
      };
    }
    try {
      await setLogistics.mutateAsync(payload);
      refresh();
      return true;
    } catch {
      toast('Could not save that. Try again.', { durationMs: 2600 });
      return false;
    }
  };

  const onContinueLogistics = async () => {
    if (await saveLogistics()) goNext();
  };

  // ── Author: resume jump-start ─────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const runParse = async () => {
    setParsing(true);
    try {
      let text = pasteText.trim();
      if (file) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/onboarding/extract', { method: 'POST', body: form });
        if (!res.ok) {
          toast('Could not read that file. Paste the text instead.', { durationMs: 2600 });
          setParsing(false);
          return;
        }
        text = ((await res.json()) as { text?: string }).text?.trim() ?? '';
      }
      if (!text) {
        toast('Add a resume file or paste some text first.', { durationMs: 2600 });
        setParsing(false);
        return;
      }
      const { draft } = await parseResumeM.mutateAsync({ text });
      // Land the draft as self-reported/pending items via the authoring
      // mutations, then the review step reflects the live profile.
      for (const sk of draft.skills) {
        await upsertSkill.mutateAsync({
          skillName: sk.name,
          skillSlug: sk.slug ?? slugify(sk.name),
          proficiency: sk.proficiency ?? 3,
        });
      }
      for (const st of draft.stories) {
        await upsertStory.mutateAsync({
          title: st.title,
          situation: st.situation,
          contribution: st.contribution,
          outcome: st.outcome ?? undefined,
        });
      }
      for (const ev of draft.evidence) {
        await addEvidence.mutateAsync({
          type: ev.type,
          title: ev.title,
          url: ev.url ?? undefined,
        });
      }
      refresh();
      toast('Draft ready. Review and edit before you go live.', { durationMs: 2600 });
      setStep('review');
    } catch {
      toast('The parse failed. You can build it by hand instead.', { durationMs: 2600 });
    } finally {
      setParsing(false);
    }
  };

  // ── Review add/edit forms ─────────────────────────────────────────────────
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillName, setSkillName] = useState('');
  const [skillProf, setSkillProf] = useState(3);

  const [storyEditingId, setStoryEditingId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [stTitle, setStTitle] = useState('');
  const [stSituation, setStSituation] = useState('');
  const [stContribution, setStContribution] = useState('');
  const [stOutcome, setStOutcome] = useState('');

  const [evOpen, setEvOpen] = useState(false);
  const [evType, setEvType] = useState<EvidenceType>('repo');
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');

  const submitSkill = async () => {
    const name = skillName.trim();
    if (!name) return;
    await upsertSkill.mutateAsync({ skillName: name, skillSlug: slugify(name), proficiency: skillProf });
    refresh();
    setSkillName('');
    setSkillProf(3);
    setSkillOpen(false);
  };

  const setSkillProficiency = async (name: string, slug: string, proficiency: number) => {
    await upsertSkill.mutateAsync({ skillName: name, skillSlug: slug, proficiency });
    refresh();
  };

  const openStoryEditor = (story?: {
    id: string;
    title: string;
    situation: string;
    contribution: string;
    outcome: string | null;
  }) => {
    setStoryEditingId(story?.id ?? null);
    setStTitle(story?.title ?? '');
    setStSituation(story?.situation ?? '');
    setStContribution(story?.contribution ?? '');
    setStOutcome(story?.outcome ?? '');
    setStoryOpen(true);
  };

  const submitStory = async () => {
    if (!stTitle.trim() || !stSituation.trim() || !stContribution.trim()) return;
    await upsertStory.mutateAsync({
      storyId: storyEditingId ?? undefined,
      title: stTitle.trim(),
      situation: stSituation.trim(),
      contribution: stContribution.trim(),
      outcome: stOutcome.trim() || undefined,
    });
    refresh();
    setStoryOpen(false);
    setStoryEditingId(null);
  };

  const submitEvidence = async () => {
    if (!evTitle.trim()) return;
    await addEvidence.mutateAsync({
      type: evType,
      title: evTitle.trim(),
      url: evUrl.trim() || undefined,
    });
    refresh();
    setEvTitle('');
    setEvUrl('');
    setEvOpen(false);
  };

  const finish = async () => {
    try {
      await completeOnboarding.mutateAsync({ visibility });
      refresh();
      toast('Your Living Profile is live.', { durationMs: 2600 });
      router.push('/profile');
    } catch {
      toast('Could not finish. Try again.', { durationMs: 2600 });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const skills = profile?.talentGraph ?? [];
  const stories = profile?.stories ?? [];
  const evidence = profile?.evidence ?? [];

  return (
    <div className={s.shell}>
      <div className={s.column}>
        <header className={s.header}>
          <div className={s.headerRow}>
            {index > 0 ? (
              <button type="button" className={s.back} onClick={goBack} aria-label="Back">
                <ArrowLeft width={18} height={18} strokeWidth={2} />
              </button>
            ) : (
              <BrandGlyph size={34} />
            )}
            <span className={s.wordmark}>Living Profile</span>
            <span className={s.counter}>
              {index + 1} / {STEP_ORDER.length}
            </span>
          </div>
          <div className={s.track}>
            <div className={s.fill} style={{ width: `${progress}%` }} />
          </div>
        </header>

        <div className={`${s.content} ${s.stepAnim}`} key={step}>
          {step === 'welcome' && (
            <div className={s.welcomeHero}>
              <div className={s.welcomeGlyphWrap}>
                <BrandGlyph size={56} />
              </div>
              <h1 className={s.h1}>Let&apos;s build your Living Profile</h1>
              <p className={s.lede}>
                Evidence beats claims. We turn what you have actually built, shipped, and
                measured into a profile sponsors can trust. Nothing goes live until you say so.
              </p>
            </div>
          )}

          {step === 'visibility' && (
            <>
              <h1 className={s.h1}>Who can see you</h1>
              <p className={s.lede}>
                You control this from day one, and you can change it anytime in settings.
              </p>
              {VIS_OPTIONS.map((opt) => {
                const on = visibility === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${s.radioCard} ${on ? s.radioCardOn : ''}`}
                    onClick={() => pickVisibility(opt)}
                  >
                    <span className={`${s.radioDot} ${on ? s.radioDotOn : ''}`}>
                      {on && <span className={s.radioInner} />}
                    </span>
                    <span>
                      <span className={s.radioTitle}>{opt.title}</span>
                      <span className={s.radioDesc}>{opt.desc}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {step === 'logistics' && (
            <>
              <h1 className={s.h1}>The logistics</h1>
              <p className={s.lede}>
                The facts a sponsor filters on, shown exactly as you declare them. All optional.
              </p>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="ob-program">Program</label>
                <input
                  id="ob-program"
                  className={s.input}
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                  placeholder="e.g. BS Computer Science"
                />
              </div>

              <div className={s.field}>
                <span className={s.fieldLabel}>Expected graduation</span>
                <div className={s.row2}>
                  <select
                    className={s.select}
                    value={gradMonth}
                    onChange={(e) => setGradMonth(e.target.value)}
                    aria-label="Graduation month"
                  >
                    <option value="">Month</option>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>
                    ))}
                  </select>
                  <select
                    className={s.select}
                    value={gradYear}
                    onChange={(e) => setGradYear(e.target.value)}
                    aria-label="Graduation year"
                  >
                    <option value="">Year</option>
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={s.field}>
                <span className={s.fieldLabel}>Degree</span>
                <div className={s.segmented}>
                  {KIND_OPTIONS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      className={`${s.segItem} ${kind === k.id ? s.segItemOn : ''}`}
                      onClick={() => setKind(k.id)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={s.field}>
                <label className={s.fieldLabel} htmlFor="ob-workauth">Work authorization</label>
                <select
                  id="ob-workauth"
                  className={s.select}
                  value={workAuthStatus}
                  onChange={(e) => setWorkAuthStatus(e.target.value as WorkAuthStatus | '')}
                >
                  <option value="">Prefer not to say</option>
                  {WORK_AUTH_OPTIONS.map((w) => (
                    <option key={w.id} value={w.id}>{w.label}</option>
                  ))}
                </select>
              </div>

              <div className={s.field}>
                <span className={s.fieldLabel}>Target locations</span>
                <input
                  className={s.input}
                  value={locInput}
                  onChange={(e) => setLocInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addLocation();
                    }
                  }}
                  placeholder="Type a city and press enter"
                />
                {locations.length > 0 && (
                  <div className={s.chips}>
                    {locations.map((loc) => (
                      <span key={loc} className={s.chip}>
                        {loc}
                        <button
                          type="button"
                          className={s.chipX}
                          onClick={() => setLocations((xs) => xs.filter((x) => x !== loc))}
                          aria-label={`Remove ${loc}`}
                        >
                          <X width={12} height={12} strokeWidth={2.5} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className={s.field}>
                <span className={s.fieldLabel}>Comp expectation</span>
                <div className={s.row2}>
                  <input
                    className={s.input}
                    value={compMin}
                    onChange={(e) => setCompMin(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder="Min"
                    aria-label="Minimum compensation"
                  />
                  <input
                    className={s.input}
                    value={compMax}
                    onChange={(e) => setCompMax(e.target.value.replace(/[^0-9]/g, ''))}
                    inputMode="numeric"
                    placeholder="Max"
                    aria-label="Maximum compensation"
                  />
                </div>
                <div className={s.segmented}>
                  <button
                    type="button"
                    className={`${s.segItem} ${!compHourly ? s.segItemOn : ''}`}
                    onClick={() => setCompHourly(false)}
                  >
                    Annual
                  </button>
                  <button
                    type="button"
                    className={`${s.segItem} ${compHourly ? s.segItemOn : ''}`}
                    onClick={() => setCompHourly(true)}
                  >
                    Hourly
                  </button>
                </div>
              </div>

              <div className={s.toggleRow}>
                <button
                  type="button"
                  className={`${s.toggle} ${startupOpen ? s.toggleOn : ''}`}
                  onClick={() => setStartupOpen((v) => !v)}
                  role="switch"
                  aria-checked={startupOpen}
                  aria-label="Open to startups"
                >
                  <span className={`${s.knob} ${startupOpen ? s.knobOn : ''}`} />
                </button>
                <span className={s.itemMeta}>Open to startups and early-stage teams</span>
              </div>
            </>
          )}

          {step === 'author' && (
            <>
              <h1 className={s.h1}>Bring in your work</h1>
              <p className={s.lede}>
                Jump-start from your resume, or build it by hand. Either way you land on a review
                you fully control. Everything starts self-reported until we verify it.
              </p>

              <div className={s.pathCard}>
                <span className={s.pathTitle}>Jump-start from your resume</span>
                <span className={s.pathHint}>
                  We read it for skills, stories, and evidence to pre-fill your review. A resume is
                  a claim, not proof, so nothing is marked verified.
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,.pdf,.txt,text/plain"
                  hidden
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <button type="button" className={s.dropZone} onClick={() => fileRef.current?.click()}>
                  {file ? (
                    <>
                      <FileText width={20} height={20} strokeWidth={1.8} />
                      <span className={s.fileName}>{file.name}</span>
                      <span>Tap to choose a different file</span>
                    </>
                  ) : (
                    <>
                      <Upload width={20} height={20} strokeWidth={1.8} />
                      <span>Upload a PDF or text resume</span>
                    </>
                  )}
                </button>
                <div className={s.divider}>or paste</div>
                <textarea
                  className={s.textarea}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Paste your resume text here"
                />
                <Pill
                  variant="accent"
                  block
                  onClick={runParse}
                  disabled={parsing || (!file && !pasteText.trim())}
                  leading={<Sparkles width={16} height={16} strokeWidth={2} />}
                >
                  {parsing ? 'Reading your resume...' : 'Parse and review'}
                </Pill>
              </div>

              <div className={s.divider}>or</div>

              <div className={s.pathCard}>
                <span className={s.pathTitle}>Build it by hand</span>
                <span className={s.pathHint}>
                  Skip the resume and add your skills, stories, and evidence yourself on the next
                  screen.
                </span>
                <Pill variant="secondary" block onClick={() => setStep('review')}>
                  Start from scratch
                </Pill>
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <h1 className={s.h1}>Review your profile</h1>
              <p className={s.lede}>
                Add, edit, and remove anything. Each item is saved as self-reported until the
                verification worker confirms it.
              </p>

              {/* Skills */}
              <div className={s.reviewGroup}>
                <div className={s.groupHead}>
                  <span className={s.groupTitle}>Skills</span>
                  <span className={s.groupCount}>{skills.length}</span>
                </div>
                {skills.length === 0 && !skillOpen && (
                  <p className={s.emptyNote}>No skills yet. Add the ones you can back up.</p>
                )}
                {skills.map((sk) => (
                  <div key={sk.skillId} className={`${s.itemCard} ${sk.verified ? '' : s.itemSelf}`}>
                    <div className={s.itemTop}>
                      <span className={s.itemTitle}>{sk.name}</span>
                      <button
                        type="button"
                        className={s.remove}
                        onClick={async () => {
                          await removeSkill.mutateAsync({ skillId: sk.skillId });
                          refresh();
                        }}
                        aria-label={`Remove ${sk.name}`}
                      >
                        <Trash2 width={15} height={15} strokeWidth={1.9} />
                      </button>
                    </div>
                    <div className={s.segmented}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`${s.segItem} ${(sk.proficiency ?? 0) === n ? s.segItemOn : ''}`}
                          onClick={() => setSkillProficiency(sk.name, sk.slug, n)}
                          aria-label={`Set ${sk.name} proficiency ${n}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {skillOpen ? (
                  <div className={s.addForm}>
                    <input
                      className={s.input}
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      placeholder="Skill name, e.g. Rust"
                      autoFocus
                    />
                    <div className={s.segmented}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`${s.segItem} ${skillProf === n ? s.segItemOn : ''}`}
                          onClick={() => setSkillProf(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className={s.row2}>
                      <Pill variant="secondary" onClick={() => setSkillOpen(false)}>Cancel</Pill>
                      <Pill variant="accent" onClick={submitSkill} disabled={!skillName.trim()}>Add</Pill>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={s.addToggle} onClick={() => setSkillOpen(true)}>
                    <Plus width={14} height={14} strokeWidth={2.4} /> Add a skill
                  </button>
                )}
              </div>

              {/* Experience stories */}
              <div className={s.reviewGroup}>
                <div className={s.groupHead}>
                  <span className={s.groupTitle}>Experience stories</span>
                  <span className={s.groupCount}>{stories.length}</span>
                </div>
                {stories.length === 0 && !storyOpen && (
                  <p className={s.emptyNote}>
                    No stories yet. A story is a real situation, what you did, and the outcome.
                  </p>
                )}
                {stories.map((st) => (
                  <div key={st.id} className={`${s.itemCard} ${s.itemSelf}`}>
                    <div className={s.itemTop}>
                      <span className={s.itemTitle}>{st.title}</span>
                      <button
                        type="button"
                        className={s.remove}
                        onClick={() => openStoryEditor(st)}
                        aria-label={`Edit ${st.title}`}
                      >
                        <Pencil width={14} height={14} strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        className={s.remove}
                        onClick={async () => {
                          await deleteStory.mutateAsync({ storyId: st.id });
                          refresh();
                        }}
                        aria-label={`Remove ${st.title}`}
                      >
                        <Trash2 width={15} height={15} strokeWidth={1.9} />
                      </button>
                    </div>
                    <div className={s.itemMeta}>{st.situation}</div>
                    <div className={s.itemMeta}>{st.contribution}</div>
                    {st.outcome ? (
                      <div className={s.itemMeta}>{st.outcome}</div>
                    ) : (
                      <div className={s.emptyNote}>Add a measured outcome to complete this story.</div>
                    )}
                  </div>
                ))}
                {storyOpen ? (
                  <div className={s.addForm}>
                    <input
                      className={s.input}
                      value={stTitle}
                      onChange={(e) => setStTitle(e.target.value)}
                      placeholder="Title, e.g. Cut checkout latency at Meridian"
                    />
                    <textarea
                      className={s.textarea}
                      value={stSituation}
                      onChange={(e) => setStSituation(e.target.value)}
                      placeholder="Situation — what was the context?"
                    />
                    <textarea
                      className={s.textarea}
                      value={stContribution}
                      onChange={(e) => setStContribution(e.target.value)}
                      placeholder="Contribution — what did you personally do?"
                    />
                    <textarea
                      className={s.textarea}
                      value={stOutcome}
                      onChange={(e) => setStOutcome(e.target.value)}
                      placeholder="Outcome — a measured result (optional but strongest)"
                    />
                    <div className={s.row2}>
                      <Pill
                        variant="secondary"
                        onClick={() => {
                          setStoryOpen(false);
                          setStoryEditingId(null);
                        }}
                      >
                        Cancel
                      </Pill>
                      <Pill
                        variant="accent"
                        onClick={submitStory}
                        disabled={!stTitle.trim() || !stSituation.trim() || !stContribution.trim()}
                      >
                        {storyEditingId ? 'Save' : 'Add'}
                      </Pill>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={s.addToggle} onClick={() => openStoryEditor()}>
                    <Plus width={14} height={14} strokeWidth={2.4} /> Add a story
                  </button>
                )}
              </div>

              {/* Evidence */}
              <div className={s.reviewGroup}>
                <div className={s.groupHead}>
                  <span className={s.groupTitle}>Evidence</span>
                  <span className={s.groupCount}>{evidence.length}</span>
                </div>
                {evidence.length === 0 && !evOpen && (
                  <p className={s.emptyNote}>
                    No evidence yet. Link a repo, paper, demo, or write-up we can check.
                  </p>
                )}
                {evidence.map((ev) => (
                  <div
                    key={ev.id}
                    className={`${s.itemCard} ${ev.provenance === 'verified' ? '' : s.itemSelf}`}
                  >
                    <div className={s.itemTop}>
                      <span className={s.itemTitle}>{ev.title}</span>
                      <button
                        type="button"
                        className={s.remove}
                        onClick={async () => {
                          await deleteEvidence.mutateAsync({ evidenceId: ev.id });
                          refresh();
                        }}
                        aria-label={`Remove ${ev.title}`}
                      >
                        <Trash2 width={15} height={15} strokeWidth={1.9} />
                      </button>
                    </div>
                    <div className={s.miniLabel}>{ev.type.replace(/_/g, ' ')}</div>
                    {ev.url && <div className={s.itemMeta}>{ev.url}</div>}
                  </div>
                ))}
                {evOpen ? (
                  <div className={s.addForm}>
                    <select
                      className={s.select}
                      value={evType}
                      onChange={(e) => setEvType(e.target.value as EvidenceType)}
                      aria-label="Evidence type"
                    >
                      {EVIDENCE_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    <input
                      className={s.input}
                      value={evTitle}
                      onChange={(e) => setEvTitle(e.target.value)}
                      placeholder="Title, e.g. railtrace ingest service"
                    />
                    <input
                      className={s.input}
                      value={evUrl}
                      onChange={(e) => setEvUrl(e.target.value)}
                      placeholder="URL (optional)"
                      inputMode="url"
                    />
                    <div className={s.row2}>
                      <Pill variant="secondary" onClick={() => setEvOpen(false)}>Cancel</Pill>
                      <Pill variant="accent" onClick={submitEvidence} disabled={!evTitle.trim()}>Add</Pill>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={s.addToggle} onClick={() => setEvOpen(true)}>
                    <Plus width={14} height={14} strokeWidth={2.4} /> Add evidence
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer action */}
        <footer className={s.footer}>
          {step === 'welcome' && (
            <Pill variant="primary" block onClick={goNext}>Continue</Pill>
          )}
          {step === 'visibility' && (
            <Pill variant="primary" block onClick={goNext}>Continue</Pill>
          )}
          {step === 'logistics' && (
            <Pill
              variant="primary"
              block
              onClick={onContinueLogistics}
              disabled={setLogistics.isPending}
            >
              {setLogistics.isPending ? 'Saving...' : 'Continue'}
            </Pill>
          )}
          {step === 'author' && (
            <button type="button" className={s.skip} onClick={() => setStep('review')}>
              Skip for now
            </button>
          )}
          {step === 'review' && (
            <Pill
              variant="primary"
              block
              onClick={finish}
              disabled={completeOnboarding.isPending}
              leading={<Check width={16} height={16} strokeWidth={2.4} />}
            >
              {completeOnboarding.isPending ? 'Finishing...' : 'Finish, make my profile live'}
            </Pill>
          )}
        </footer>
      </div>
    </div>
  );
}
