'use client';

// The ops student-creation tool. A roster of every student (newest first) plus
// a "Create student profile" modal that mints a user + student row through
// ops.createStudent — with an optional resume paste that auto-fills skills,
// stories, and evidence. Dark ops chrome, consistent with the OpsConsole. The
// roster refetches after each creation; the canonical bottom-center toast fires
// once ("Profile created for {name}.").

import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import {
  studentKindValues,
  visibilityValues,
  workAuthStatusValues,
  type StudentKind,
  type Visibility,
  type WorkAuthStatus,
  type ScreenStatus,
} from '@tartan/types';
import type { AppRouter } from '@/server/routers/_app';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import styles from '../ops.module.css';

type StudentRow =
  inferRouterOutputs<AppRouter>['ops']['opsStudents']['students'][number];

const KIND_LABEL: Record<StudentKind, string> = {
  undergrad: 'Undergrad',
  grad: 'Grad',
  alum: 'Alum',
};

const VISIBILITY_LABEL: Record<Visibility, string> = {
  searchable: 'Searchable',
  match_only: 'Match only',
  paused: 'Paused',
};
const VISIBILITY_CLASS: Record<Visibility, string | undefined> = {
  searchable: styles.statusBlue,
  match_only: styles.statusNeutral,
  paused: styles.statusAmber,
};

const WORK_AUTH_LABEL: Record<WorkAuthStatus, string> = {
  citizen: 'US citizen',
  permanent_resident: 'Permanent resident',
  f1_opt: 'F-1 OPT',
  f1_cpt: 'F-1 CPT',
  h1b_needed: 'H-1B needed',
  other: 'Other',
};

const SCREEN_LABEL: Record<ScreenStatus, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  processing: 'Processing',
  review: 'In review',
  published: 'Published',
  struck: 'Struck',
};
const SCREEN_CLASS: Record<ScreenStatus, string | undefined> = {
  scheduled: styles.statusNeutral,
  live: styles.statusNeutral,
  processing: styles.statusAmber,
  review: styles.statusAmber,
  published: styles.statusBlue,
  struck: styles.statusGray,
};

function ArrowLeftIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

interface FormState {
  name: string;
  email: string;
  andrewId: string;
  kind: StudentKind;
  program: string;
  gradDate: string;
  visibility: Visibility;
  resumeText: string;
  workAuthStatus: WorkAuthStatus | '';
  needsSponsorship: boolean;
  locations: string;
  compMin: string;
  compMax: string;
  compHourly: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  andrewId: '',
  kind: 'undergrad',
  program: '',
  gradDate: '',
  visibility: 'searchable',
  resumeText: '',
  workAuthStatus: '',
  needsSponsorship: false,
  locations: '',
  compMin: '',
  compMax: '',
  compHourly: false,
};

export interface OpsStudentsProps {
  initialStudents: StudentRow[];
  operatorInitial: string;
}

export function OpsStudents({
  initialStudents,
  operatorInitial,
}: OpsStudentsProps) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const rosterQuery = trpc.ops.opsStudents.useQuery(undefined, {
    initialData: { students: initialStudents },
  });
  const students = rosterQuery.data?.students ?? initialStudents;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const createMutation = trpc.ops.createStudent.useMutation();
  const submitting = createMutation.isPending;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function closeModal() {
    if (submitting) return;
    setOpen(false);
    setError(null);
    setForm(EMPTY_FORM);
  }

  const canSubmit =
    form.name.trim().length > 0 && form.email.trim().length > 0 && !submitting;

  function submit() {
    if (!canSubmit) return;
    setError(null);

    const locations = form.locations
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const compMin = form.compMin.trim() ? Number(form.compMin) : undefined;
    const compMax = form.compMax.trim() ? Number(form.compMax) : undefined;
    const hasComp = compMin !== undefined || compMax !== undefined;

    createMutation.mutate(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        andrewId: form.andrewId.trim() || undefined,
        kind: form.kind,
        program: form.program.trim() || undefined,
        gradDateISO: form.gradDate
          ? new Date(form.gradDate).toISOString()
          : undefined,
        visibility: form.visibility,
        resumeText: form.resumeText.trim() || undefined,
        workAuth: form.workAuthStatus
          ? {
              status: form.workAuthStatus,
              needsSponsorship: form.needsSponsorship,
            }
          : undefined,
        locations: locations.length > 0 ? locations : undefined,
        compExpectation: hasComp
          ? {
              ...(compMin !== undefined ? { min: compMin } : {}),
              ...(compMax !== undefined ? { max: compMax } : {}),
              hourly: form.compHourly,
              currency: 'USD',
            }
          : undefined,
      },
      {
        onSuccess: async () => {
          const created = form.name.trim();
          setOpen(false);
          setForm(EMPTY_FORM);
          toast(`Profile created for ${created}.`);
          await utils.ops.opsStudents.invalidate();
        },
        onError: (e) => {
          setError(e.message || 'Could not create the profile. Try again.');
        },
      },
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.hubLink} href="/">
          <ArrowLeftIcon />
          Hub
        </a>
        <span className={styles.divider} />
        <span className={styles.brand}>Talent Ops</span>
        <nav className={styles.nav}>
          <a className={styles.navTab} href="/ops">
            Exception queue
          </a>
          <a
            className={`${styles.navTab} ${styles.navTabActive}`}
            href="/ops/students"
            aria-current="page"
          >
            Students
          </a>
        </nav>
        <span className={styles.scopePill}>
          internal · ops-minted profiles still run every trust check
        </span>
        <div className={styles.headerMeta}>
          <span className={styles.digestStamp}>{students.length} students</span>
          <div className={styles.avatar}>{operatorInitial}</div>
        </div>
      </header>

      <div className={styles.studentsBody}>
        <div className={styles.studentsHeader}>
          <div className={styles.studentsTitleCol}>
            <span className={styles.studentsTitle}>Students</span>
            <span className={styles.studentsSubtitle}>
              Every profile on the platform · create one from scratch, with an
              optional resume to jump-start skills, stories, and evidence
            </span>
          </div>
          <button className={styles.createBtn} onClick={() => setOpen(true)}>
            Create student profile
          </button>
        </div>

        <div className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={styles.roster}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Program</th>
                  <th>Kind</th>
                  <th>Visibility</th>
                  <th>Skills</th>
                  <th>Screen</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.studentId}>
                    <td>
                      <div className={styles.rosterName}>{s.name}</div>
                      <div className={styles.rosterSub}>
                        {s.andrewId ?? s.email}
                      </div>
                    </td>
                    <td>
                      {s.program ? (
                        s.program
                      ) : (
                        <span className={styles.rosterMuted}>Not set</span>
                      )}
                    </td>
                    <td>{KIND_LABEL[s.kind]}</td>
                    <td>
                      <span
                        className={`${styles.statusPill} ${VISIBILITY_CLASS[s.visibility]}`}
                      >
                        {VISIBILITY_LABEL[s.visibility]}
                      </span>
                    </td>
                    <td className={styles.rosterMono}>{s.skillCount}</td>
                    <td>
                      {s.screenStatus ? (
                        <span
                          className={`${styles.statusPill} ${SCREEN_CLASS[s.screenStatus]}`}
                        >
                          {SCREEN_LABEL[s.screenStatus]}
                        </span>
                      ) : (
                        <span
                          className={`${styles.statusPill} ${styles.statusGray}`}
                        >
                          No screen
                        </span>
                      )}
                    </td>
                    <td className={styles.rosterMono}>
                      {formatRelative(s.createdAt)}
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.emptyRoster}>
                      No students yet. Create the first profile to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {open && (
        <div
          className={styles.overlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Create student profile"
          >
            <div className={styles.modalHead}>
              <div>
                <div className={styles.modalTitle}>Create student profile</div>
                <div className={styles.modalSubtitle}>
                  Mints the account and stamps it onboarded. The student can edit
                  everything from their own Living Profile.
                </div>
              </div>
              <button
                className={styles.modalClose}
                onClick={closeModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-name">
                    Name
                  </label>
                  <input
                    id="cs-name"
                    className={styles.input}
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="Ada Lovelace"
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-email">
                    Email
                  </label>
                  <input
                    id="cs-email"
                    className={styles.input}
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="ada@andrew.cmu.edu"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-andrew">
                    Andrew id
                  </label>
                  <input
                    id="cs-andrew"
                    className={styles.input}
                    value={form.andrewId}
                    onChange={(e) => set('andrewId', e.target.value)}
                    placeholder="alovelac"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-kind">
                    Kind
                  </label>
                  <select
                    id="cs-kind"
                    className={styles.select}
                    value={form.kind}
                    onChange={(e) => set('kind', e.target.value as StudentKind)}
                  >
                    {studentKindValues.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-program">
                    Program
                  </label>
                  <input
                    id="cs-program"
                    className={styles.input}
                    value={form.program}
                    onChange={(e) => set('program', e.target.value)}
                    placeholder="Computer Science"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-grad">
                    Graduation date
                  </label>
                  <input
                    id="cs-grad"
                    className={styles.input}
                    type="date"
                    value={form.gradDate}
                    onChange={(e) => set('gradDate', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-vis">
                    Visibility
                  </label>
                  <select
                    id="cs-vis"
                    className={styles.select}
                    value={form.visibility}
                    onChange={(e) =>
                      set('visibility', e.target.value as Visibility)
                    }
                  >
                    {visibilityValues.map((v) => (
                      <option key={v} value={v}>
                        {VISIBILITY_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="cs-resume">
                  Resume (optional)
                </label>
                <textarea
                  id="cs-resume"
                  className={styles.textarea}
                  value={form.resumeText}
                  onChange={(e) => set('resumeText', e.target.value)}
                  placeholder="Paste a resume to auto-fill skills, stories, and evidence"
                />
                <span className={styles.hint}>
                  Paste a resume to auto-fill skills, stories, and evidence. Every
                  parsed item lands self-reported and unverified until a screen
                  and the verifier confirm it.
                </span>
              </div>

              <span className={styles.sectionLabel}>Logistics (optional)</span>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-workauth">
                    Work authorization
                  </label>
                  <select
                    id="cs-workauth"
                    className={styles.select}
                    value={form.workAuthStatus}
                    onChange={(e) =>
                      set(
                        'workAuthStatus',
                        e.target.value as WorkAuthStatus | '',
                      )
                    }
                  >
                    <option value="">Not stated</option>
                    {workAuthStatusValues.map((w) => (
                      <option key={w} value={w}>
                        {WORK_AUTH_LABEL[w]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.checkRow}>
                  <input
                    id="cs-sponsor"
                    type="checkbox"
                    checked={form.needsSponsorship}
                    onChange={(e) => set('needsSponsorship', e.target.checked)}
                    disabled={!form.workAuthStatus}
                  />
                  <label htmlFor="cs-sponsor">Needs visa sponsorship</label>
                </div>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label className={styles.label} htmlFor="cs-locations">
                    Locations
                  </label>
                  <input
                    id="cs-locations"
                    className={styles.input}
                    value={form.locations}
                    onChange={(e) => set('locations', e.target.value)}
                    placeholder="Pittsburgh, Remote, New York"
                  />
                  <span className={styles.hint}>Comma-separated.</span>
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-compmin">
                    Comp min
                  </label>
                  <input
                    id="cs-compmin"
                    className={styles.input}
                    type="number"
                    min="0"
                    value={form.compMin}
                    onChange={(e) => set('compMin', e.target.value)}
                    placeholder="90000"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="cs-compmax">
                    Comp max
                  </label>
                  <input
                    id="cs-compmax"
                    className={styles.input}
                    type="number"
                    min="0"
                    value={form.compMax}
                    onChange={(e) => set('compMax', e.target.value)}
                    placeholder="120000"
                  />
                </div>
                <div className={styles.checkRow}>
                  <input
                    id="cs-hourly"
                    type="checkbox"
                    checked={form.compHourly}
                    onChange={(e) => set('compHourly', e.target.checked)}
                  />
                  <label htmlFor="cs-hourly">Hourly rate</label>
                </div>
              </div>
            </div>

            <div className={styles.modalFoot}>
              {error && <span className={styles.errorText}>{error}</span>}
              <button
                className={styles.ghostBtn}
                onClick={closeModal}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className={styles.primaryBtn}
                onClick={submit}
                disabled={!canSubmit}
              >
                {submitting
                  ? form.resumeText.trim()
                    ? 'Parsing resume…'
                    : 'Creating…'
                  : 'Create profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
