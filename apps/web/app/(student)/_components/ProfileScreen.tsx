'use client';

import { useState } from 'react';
import { Eye, Plus, Pencil, Check } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { TartanBand, useToast } from '@/components/ui';
import styles from '../student.module.css';
import { StudentShell } from './StudentShell';
import { Avatar, TapFloorLink } from './parts';
import { SponsorPanel } from './SponsorPanel';
import { evidenceState, evidenceCaption, clockLabel } from './format';
import {
  ProficiencyStepper,
  AddSkillForm,
  StoryForm,
  LogisticsForm,
  IconButton,
  FIELD_LABEL,
  FIELD_INPUT,
  Trash2,
  type StoryDraft,
  type LogisticsDraft,
} from './ProfileEditors';
import type { EvidenceType, ProfileOutput, TalentGraphSkill } from '@tartan/types';

const ROOT: React.CSSProperties = { padding: '64px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 };

// The subset of evidence types a student can self-attach (interview_moment is
// minted by the Rep during a screen, never added by hand).
const EVIDENCE_TYPES: { value: EvidenceType; label: string }[] = [
  { value: 'repo', label: 'Repo' },
  { value: 'paper', label: 'Paper' },
  { value: 'demo', label: 'Demo' },
  { value: 'hackathon', label: 'Hackathon' },
  { value: 'course', label: 'Course' },
  { value: 'work', label: 'Work' },
];

const EDGE: Record<string, { edge: string; capFg: string; dashed: boolean; fg: string; op: number }> = {
  verified: { edge: '#0e96d1', capFg: '#0a6b94', dashed: false, fg: '#1e1e1e', op: 1 },
  audio: { edge: '#6940c9', capFg: '#4b2d8f', dashed: false, fg: '#1e1e1e', op: 1 },
  pending: { edge: '#e8b13a', capFg: '#654a00', dashed: false, fg: '#1e1e1e', op: 1 },
  self_reported: { edge: '#c7d2dc', capFg: '#5f6f7f', dashed: false, fg: '#1e1e1e', op: 1 },
  missing: { edge: '#c7d2dc', capFg: '#869db3', dashed: true, fg: '#5f6f7f', op: 0.75 },
};

function monthYearOf(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function outcomePrompt(title: string): string {
  return /meridian/i.test(title)
    ? 'Add a measured outcome. What happened to the drop rate?'
    : 'Add a measured outcome to complete this story.';
}

export function ProfileScreen() {
  const { data, isLoading } = trpc.student.profile.useQuery(undefined, {
    // While any evidence is pending verification, gently poll so the provenance
    // flip (pending -> verified) surfaces without a manual refresh. Idle once
    // nothing is pending.
    refetchInterval: (q) =>
      q.state.data?.evidence?.some((e) => e.provenance === 'pending') ? 20_000 : false,
  });
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const notify = (m: string) => toast(m, { durationMs: 2600 });

  // ── mutations ────────────────────────────────────────────────────────────
  const addEvidence = trpc.student.addEvidence.useMutation();
  const upsertSkillClaim = trpc.student.upsertSkillClaim.useMutation();
  const deleteSkillClaim = trpc.student.deleteSkillClaim.useMutation();
  const upsertStory = trpc.student.upsertStory.useMutation();
  const deleteStory = trpc.student.deleteStory.useMutation();
  const updateEvidence = trpc.student.updateEvidence.useMutation();
  const deleteEvidence = trpc.student.deleteEvidence.useMutation();
  const updateProfile = trpc.student.updateProfile.useMutation();

  const [viewSponsor, setViewSponsor] = useState(false);
  const [editMode, setEditMode] = useState(false);
  // undefined = untouched (defaults to the first skill, like the prototype's
  // initial expandedSkill); null = explicitly deselected (empty state shows).
  const [expandedSkill, setExpandedSkill] = useState<string | null | undefined>(undefined);

  // Edit-surface state.
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [logisticsOpen, setLogisticsOpen] = useState(false);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);

  // Add-evidence form state.
  const [addOpen, setAddOpen] = useState(false);
  const [evType, setEvType] = useState<EvidenceType>('repo');
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evSkill, setEvSkill] = useState(''); // skill slug or '' (no wiring yet)

  // claim-id map: the read model exposes skillId, not the skill_claims.id that
  // deleteSkillClaim needs. Fetched only while editing.
  const claimIndex = trpc.student.skillClaimIndex.useQuery(undefined, { enabled: editMode });
  const claimBySkill = new Map((claimIndex.data?.items ?? []).map((i) => [i.skillId, i.skillClaimId]));

  const screenId = data?.screenDossierCard?.screenId;
  const review = trpc.student.screenReview.useQuery(
    { screenId: screenId ?? '' },
    { enabled: viewSponsor && Boolean(screenId) },
  );

  // ── optimistic cache helpers ─────────────────────────────────────────────
  const patchProfile = (mut: (p: ProfileOutput) => ProfileOutput): ProfileOutput | undefined => {
    const prev = utils.student.profile.getData();
    if (prev) utils.student.profile.setData(undefined, mut(prev));
    return prev;
  };
  const rollback = (prev: ProfileOutput | undefined) => {
    if (prev) utils.student.profile.setData(undefined, prev);
  };
  const settle = () => {
    void utils.student.profile.invalidate();
    void utils.student.ledger.invalidate();
    void utils.student.skillClaimIndex.invalidate();
  };

  if (isLoading || !data) {
    return (
      <StudentShell active="profile">
        <div style={{ ...ROOT, color: '#869db3' }}>Loading your profile…</div>
      </StudentShell>
    );
  }

  const { identity, logisticsChips, talentGraph, evidence, stories, screenDossierCard } = data;
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const selected =
    expandedSkill === undefined ? (talentGraph[0]?.skillId ?? null) : expandedSkill;
  const activeSkill = talentGraph.find((s) => s.skillId === selected) ?? null;

  // ── handlers ───────────────────────────────────────────────────────────────
  const saveSkillProficiency = (skill: TalentGraphSkill, next: number) => {
    const prev = patchProfile((p) => ({
      ...p,
      talentGraph: p.talentGraph.map((s) => (s.skillId === skill.skillId ? { ...s, proficiency: next } : s)),
    }));
    upsertSkillClaim.mutate(
      { skillName: skill.name, skillSlug: skill.slug, proficiency: next },
      {
        onError: () => {
          rollback(prev);
          notify('Could not save that. Please try again.');
        },
        onSettled: settle,
      },
    );
  };

  const addSkill = (name: string, proficiency: number) => {
    upsertSkillClaim.mutate(
      { skillName: name, proficiency },
      {
        onSuccess: (res) => {
          notify('Skill added.');
          setExpandedSkill(res.skill.skillId);
        },
        onError: () => notify('Could not add that skill.'),
        onSettled: settle,
      },
    );
  };

  const removeSkill = (skill: TalentGraphSkill) => {
    const claimId = claimBySkill.get(skill.skillId);
    if (!claimId) {
      notify('One moment, still loading. Try again.');
      return;
    }
    if (selected === skill.skillId) setExpandedSkill(null);
    const prev = patchProfile((p) => ({
      ...p,
      talentGraph: p.talentGraph.filter((s) => s.skillId !== skill.skillId),
    }));
    deleteSkillClaim.mutate(
      { skillClaimId: claimId },
      {
        onSuccess: () => notify('Skill removed.'),
        onError: () => {
          rollback(prev);
          notify('Could not remove that skill.');
        },
        onSettled: settle,
      },
    );
  };

  const saveStory = (draft: StoryDraft, storyId?: string) => {
    upsertStory.mutate(
      {
        storyId,
        title: draft.title,
        situation: draft.situation,
        contribution: draft.contribution,
        outcome: draft.outcome ? draft.outcome : undefined,
      },
      {
        onSuccess: () => {
          notify(storyId ? 'Story saved.' : 'Story added.');
          setEditingStoryId(null);
          setNewStoryOpen(false);
        },
        onError: () => notify('Could not save that story.'),
        onSettled: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
        },
      },
    );
  };

  const removeStory = (storyId: string) => {
    const prev = patchProfile((p) => ({ ...p, stories: p.stories.filter((s) => s.id !== storyId) }));
    deleteStory.mutate(
      { storyId },
      {
        onSuccess: () => notify('Story removed.'),
        onError: () => {
          rollback(prev);
          notify('Could not remove that story.');
        },
        onSettled: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
        },
      },
    );
  };

  const saveEvidenceEdit = (evidenceId: string, title: string, url: string) => {
    updateEvidence.mutate(
      { evidenceId, title, url: url.trim() ? url.trim() : null },
      {
        onSuccess: () => {
          notify('Evidence updated. Verification is queued.');
          setEditingEvidenceId(null);
        },
        onError: () => notify('Could not update that.'),
        onSettled: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
        },
      },
    );
  };

  const removeEvidence = (evidenceId: string) => {
    const prev = patchProfile((p) => ({
      ...p,
      evidence: p.evidence.filter((e) => e.id !== evidenceId),
      talentGraph: p.talentGraph.map((s) => ({
        ...s,
        evidenceIds: s.evidenceIds.filter((id) => id !== evidenceId),
      })),
    }));
    deleteEvidence.mutate(
      { evidenceId },
      {
        onSuccess: () => notify('Evidence removed.'),
        onError: () => {
          rollback(prev);
          notify('Could not remove that.');
        },
        onSettled: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
        },
      },
    );
  };

  const saveLogistics = (draft: LogisticsDraft) => {
    const hasComp = draft.compMin != null || draft.compMax != null;
    updateProfile.mutate(
      {
        program: draft.program.trim() ? draft.program.trim() : undefined,
        gradDate: draft.gradDate ? draft.gradDate : undefined,
        workAuth: {
          status: draft.workAuthStatus,
          needsSponsorship: draft.workAuthStatus === 'h1b_needed',
        },
        locations: draft.locations,
        compExpectation: hasComp
          ? {
              min: draft.compMin ?? undefined,
              max: draft.compMax ?? undefined,
              hourly: draft.compHourly,
              currency: 'USD',
            }
          : undefined,
        startupOpen: draft.startupOpen,
      },
      {
        onSuccess: () => {
          notify('Logistics saved.');
          setLogisticsOpen(false);
        },
        onError: () => notify('Could not save logistics.'),
        onSettled: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
        },
      },
    );
  };

  const submitEvidence = () => {
    const title = evTitle.trim();
    if (!title || addEvidence.isPending) return;
    const wiredSkillId = evSkill ? talentGraph.find((s) => s.slug === evSkill)?.skillId : undefined;
    addEvidence.mutate(
      {
        type: evType,
        title,
        url: evUrl.trim() || undefined,
        skillSlugs: evSkill ? [evSkill] : undefined,
      },
      {
        onSuccess: () => {
          void utils.student.profile.invalidate();
          void utils.student.ledger.invalidate();
          notify('Added. Verification is queued.');
          // Reveal the new pending item under the skill it was wired to.
          if (wiredSkillId) setExpandedSkill(wiredSkillId);
          setEvTitle('');
          setEvUrl('');
          setEvSkill('');
          setAddOpen(false);
        },
        onError: () => notify('Could not add that. Please try again.'),
      },
    );
  };

  const [degree, school] = (identity.program ?? '').split(', ');
  const metaPhone = [school, degree, monthYearOf(identity.gradDate)].filter(Boolean).join(' · ');

  const logisticsInitial: LogisticsDraft = {
    program: identity.program ?? '',
    gradDate: identity.gradDate ? identity.gradDate.slice(0, 10) : '',
    workAuthStatus: data.workAuth?.status ?? 'other',
    locations: data.locations ?? [],
    compMin: data.compExpectation?.min ?? null,
    compMax: data.compExpectation?.max ?? null,
    compHourly: data.compExpectation?.hourly ?? false,
    startupOpen: data.startupOpen,
  };

  // Evidence card renderer (read + edit branch share it).
  const renderEvidenceCard = (eid: string) => {
    const e = evidenceById.get(eid);
    if (!e) return null;
    const st = evidenceState(e.type, e.provenance, e.url);
    const c = EDGE[st]!;
    const editingThis = editMode && editingEvidenceId === e.id;
    if (editingThis) {
      return <InlineEvidenceEdit key={eid} initialTitle={e.title} initialUrl={e.url ?? ''} pending={updateEvidence.isPending} onSave={(t, u) => saveEvidenceEdit(e.id, t, u)} onCancel={() => setEditingEvidenceId(null)} />;
    }
    return (
      <div key={eid} style={{ border: `1px ${c.dashed ? 'dashed' : 'solid'} ${c.dashed ? '#c7d2dc' : '#e9ebf8'}`, borderLeft: `3px solid ${c.edge}`, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3, opacity: c.op, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.35, color: c.fg }}>{e.title}</div>
          {editMode && (
            <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
              <IconButton label="Edit evidence" onClick={() => setEditingEvidenceId(e.id)}>
                <Pencil size={12} strokeWidth={2} />
              </IconButton>
              <IconButton label="Remove evidence" tone="danger" onClick={() => removeEvidence(e.id)}>
                <Trash2 size={12} strokeWidth={2} />
              </IconButton>
            </div>
          )}
        </div>
        <div style={{ fontSize: 8.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: c.capFg }}>{evidenceCaption(e.type, e.provenance, e.url)}</div>
      </div>
    );
  };

  const content = (
    <div style={ROOT}>
      {/* Title + edit / view-as-sponsor toggles */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>Living Profile</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!viewSponsor && (
            <button
              type="button"
              onClick={() => {
                setEditMode((v) => !v);
                setLogisticsOpen(false);
                setNewStoryOpen(false);
                setEditingStoryId(null);
                setEditingEvidenceId(null);
              }}
              className={`${styles.sponsorToggle} ${editMode ? styles.sponsorToggleActive : ''}`}
            >
              {editMode ? <Check size={14} strokeWidth={2.4} /> : <Pencil size={13} strokeWidth={2} />}
              {editMode ? 'Done' : 'Edit profile'}
            </button>
          )}
          {!editMode && (
            <button
              type="button"
              onClick={() => setViewSponsor((v) => !v)}
              className={`${styles.sponsorToggle} ${viewSponsor ? styles.sponsorToggleActive : ''}`}
            >
              <Eye size={14} strokeWidth={2} />
              View as sponsor
            </button>
          )}
        </div>
      </div>

      {/* Identity card */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar size={52} radius={14} fontSize={18}>{identity.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.015em' }}>{identity.name}</div>
            <div style={{ fontSize: 12.5, color: '#4a5662' }}>{metaPhone || (editMode ? 'Add your program and graduation date' : '')}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#869db3' }}>{identity.andrewId ? `${identity.andrewId} · verified via CMU SSO` : 'no andrew id on file'}</div>
          </div>
          {editMode && !logisticsOpen && (
            <button type="button" onClick={() => setLogisticsOpen(true)} className={styles.linkBtn} style={{ minHeight: 44, fontSize: 12, fontWeight: 600, color: '#0a6b94', display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>
              <Pencil size={13} strokeWidth={2} /> Edit
            </button>
          )}
        </div>
        {editMode && logisticsOpen ? (
          <LogisticsForm initial={logisticsInitial} onSave={saveLogistics} onCancel={() => setLogisticsOpen(false)} pending={updateProfile.isPending} />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {logisticsChips.map((c) => (
              <span key={c.label} style={{ fontSize: 11.5, fontWeight: 500, color: '#4a5662', background: '#f0f4f8', borderRadius: 4, padding: '5px 9px' }}>{c.value}</span>
            ))}
          </div>
        )}
      </div>

      {/* Talent Graph */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Talent Graph</div>
          <div style={{ fontSize: 11, color: '#869db3' }}>{editMode ? 'set proficiency, wire proof, or remove' : 'tap a skill to light its thread'}</div>
        </div>

        {editMode ? (
          // Edit mode: full-width skill rows + the selected skill's thread below.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {talentGraph.length === 0 && (
              <div style={{ fontSize: 12, color: '#869db3', lineHeight: 1.5 }}>Add your first skill to start your Talent Graph.</div>
            )}
            {talentGraph.map((s) => {
              const isSel = s.skillId === selected;
              const chip: React.CSSProperties = isSel
                ? { background: '#eef7fb', border: '1.5px solid #063f58' }
                : s.verified
                  ? { background: '#f6fbfd', border: '1.5px solid #90cfea' }
                  : { background: '#fff', border: '1.5px dashed #aebdcc' };
              return (
                <div key={s.skillId} style={{ borderRadius: 12, padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 8, ...chip }}>
                  <button
                    type="button"
                    onClick={() => setExpandedSkill(isSel ? null : s.skillId)}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', gap: 2, minHeight: 44, justifyContent: 'center' }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1e1e1e' }}>{s.name}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#869db3', fontWeight: 500 }}>{s.verified ? `${s.evidenceIds.length} wired` : 'no proof yet'}</span>
                  </button>
                  <ProficiencyStepper value={s.proficiency ?? 3} onChange={(n) => saveSkillProficiency(s, n)} disabled={upsertSkillClaim.isPending} />
                  <IconButton label="Remove skill" tone="danger" onClick={() => removeSkill(s)} disabled={deleteSkillClaim.isPending}>
                    <Trash2 size={14} strokeWidth={2} />
                  </IconButton>
                </div>
              );
            })}
            <AddSkillForm onAdd={addSkill} pending={upsertSkillClaim.isPending} />

            {activeSkill && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 4, paddingTop: 10, borderTop: '1px dashed #e2e8ee' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#0a6b94' }}>Proof wired to {activeSkill.name}</div>
                {activeSkill.evidenceIds.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#869db3', lineHeight: 1.5 }}>No proof yet. Use “Add evidence” below and wire it to this skill.</div>
                ) : (
                  activeSkill.evidenceIds.map((eid) => renderEvidenceCard(eid))
                )}
              </div>
            )}
          </div>
        ) : (
          // Read mode: the two-column skill / evidence thread.
          <div style={{ display: 'flex' }}>
            <div style={{ width: 120, flex: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {talentGraph.length === 0 ? (
                <div style={{ fontSize: 11, color: '#869db3', lineHeight: 1.5 }}>Add your first skill.</div>
              ) : (
                talentGraph.map((s) => {
                  const isSel = s.skillId === selected;
                  const style: React.CSSProperties = isSel
                    ? { background: '#063f58', color: '#fff', border: '1.5px solid #063f58' }
                    : s.verified
                      ? { background: '#e7f5fa', color: '#0a6b94', border: '1.5px solid #90cfea' }
                      : { background: '#fff', color: '#5f6f7f', border: '1.5px dashed #aebdcc' };
                  return (
                    <button
                      key={s.skillId}
                      type="button"
                      onClick={() => setExpandedSkill(selected === s.skillId ? null : s.skillId)}
                      style={{ padding: '8px 11px', borderRadius: 12, fontWeight: 600, fontSize: 11, textAlign: 'left', lineHeight: 1.35, display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', ...style }}
                    >
                      <span>{s.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, opacity: 0.7, fontWeight: 500 }}>
                        {s.verified ? `${s.evidenceIds.length} wired` : 'no proof yet'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div style={{ width: 16, flex: 'none', borderLeft: '2px solid #90cfea', borderBottom: '2px solid #90cfea', borderRadius: '0 0 0 10px', height: 170, marginTop: 16 }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, marginLeft: -6, paddingTop: 4 }}>
              {activeSkill ? (
                <>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#0a6b94', paddingLeft: 2 }}>{activeSkill.name}</div>
                  {activeSkill.evidenceIds.map((eid) => renderEvidenceCard(eid))}
                </>
              ) : (
                <div style={{ border: '1px dashed #c7d2dc', borderRadius: 8, padding: 12, marginTop: 14, fontSize: 11, lineHeight: 1.5, color: '#869db3' }}>
                  Tap a skill on the left to trace its evidence thread.
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, lineHeight: 1.5, color: '#869db3' }}>
          Solid chips are wired to proof; dashed claims dangle until evidence attaches. Sponsors see the same wiring.
        </div>
      </div>

      {/* Add evidence — dashed, pending-provenance affordance under the graph */}
      <div style={{ border: '1px dashed #aebdcc', borderRadius: 12, background: '#f8fafc', overflow: 'hidden' }}>
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#e7f5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <Plus size={15} strokeWidth={2} color="#0a6b94" />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1e1e' }}>Add evidence</span>
              <span style={{ fontSize: 11, lineHeight: 1.4, color: '#869db3' }}>Attach proof to wire a skill. We verify it, then it goes solid.</span>
            </span>
          </button>
        ) : (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1e1e' }}>Add evidence</div>
              <button type="button" onClick={() => setAddOpen(false)} className={styles.linkBtn} style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 12, color: '#5f6f7f' }}>Cancel</button>
            </div>

            <label style={FIELD_LABEL} htmlFor="ev-type">Type</label>
            <select id="ev-type" value={evType} onChange={(e) => setEvType(e.target.value as EvidenceType)} style={FIELD_INPUT}>
              {EVIDENCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            <label style={FIELD_LABEL} htmlFor="ev-title">Title</label>
            <input id="ev-title" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} placeholder="e.g. railtrace repo, 14 commits" style={FIELD_INPUT} />

            <label style={FIELD_LABEL} htmlFor="ev-url">Link (optional)</label>
            <input id="ev-url" value={evUrl} onChange={(e) => setEvUrl(e.target.value)} placeholder="https://" inputMode="url" style={FIELD_INPUT} />

            <label style={FIELD_LABEL} htmlFor="ev-skill">Wire to a skill (optional)</label>
            <select id="ev-skill" value={evSkill} onChange={(e) => setEvSkill(e.target.value)} style={FIELD_INPUT}>
              <option value="">No skill yet</option>
              {talentGraph.map((s) => (
                <option key={s.skillId} value={s.slug}>{s.name}</option>
              ))}
            </select>

            <button
              type="button"
              disabled={!evTitle.trim() || addEvidence.isPending}
              onClick={submitEvidence}
              className={evTitle.trim() && !addEvidence.isPending ? styles.btnDark : styles.btnDisabled}
              style={{ height: 44, fontSize: 13.5, fontWeight: 600, marginTop: 2 }}
            >
              {addEvidence.isPending ? 'Adding…' : 'Add evidence'}
            </button>
          </div>
        )}
      </div>

      {/* Experience stories */}
      <div style={{ fontSize: 13, fontWeight: 600, padding: '0 2px' }}>Experience stories</div>
      {stories.length === 0 && !newStoryOpen && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', fontSize: 12.5, lineHeight: 1.55, color: '#869db3', boxShadow: 'var(--shadow-resting)' }}>
          {editMode ? 'Tell your first story. Setup, your part, and a measured outcome.' : 'No stories yet.'}
        </div>
      )}
      {stories.map((story) =>
        editMode && editingStoryId === story.id ? (
          <StoryForm
            key={story.id}
            initial={{ title: story.title, situation: story.situation, contribution: story.contribution, outcome: story.outcome ?? '' }}
            onSave={(d) => saveStory(d, story.id)}
            onCancel={() => setEditingStoryId(null)}
            pending={upsertStory.isPending}
            submitLabel="Save story"
          />
        ) : (
          <div key={story.id} style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{story.title}</div>
              {editMode && (
                <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                  <IconButton label="Edit story" onClick={() => setEditingStoryId(story.id)}>
                    <Pencil size={13} strokeWidth={2} />
                  </IconButton>
                  <IconButton label="Remove story" tone="danger" onClick={() => removeStory(story.id)} disabled={deleteStory.isPending}>
                    <Trash2 size={13} strokeWidth={2} />
                  </IconButton>
                </div>
              )}
            </div>
            {([['Setup', story.situation, '#4a5662', false], ['Your part', story.contribution, '#1e1e1e', false], ['Outcome', story.outcome ?? outcomePrompt(story.title), story.outcome ? '#1e1e1e' : '#991a30', !story.outcome]] as const).map(([label, value, color, italic]) => (
              <div key={label} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#869db3', paddingTop: 1 }}>{label}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color, fontStyle: italic ? 'italic' : 'normal' }}>{value}</div>
              </div>
            ))}
          </div>
        ),
      )}
      {editMode &&
        (newStoryOpen ? (
          <StoryForm
            onSave={(d) => saveStory(d)}
            onCancel={() => setNewStoryOpen(false)}
            pending={upsertStory.isPending}
            submitLabel="Add story"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNewStoryOpen(true)}
            style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#f8fafc', border: '1px dashed #aebdcc', borderRadius: 12, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#e7f5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
              <Plus size={15} strokeWidth={2} color="#0a6b94" />
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1e1e' }}>{stories.length === 0 ? 'Tell your first story' : 'Add a story'}</span>
          </button>
        ))}

      {/* Screen Dossier card */}
      {screenDossierCard && (
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-resting)' }}>
          <TartanBand recipe="student" thickness={5} />
          <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Screen Dossier</div>
              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '3px 8px', ...(screenDossierCard.statusTone === 'green' ? { color: '#0d4b17', background: '#dcefe0' } : { color: '#654a00', background: '#fdf6e3' }) }}>
                {screenDossierCard.statusLabel}
              </span>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: '#4a5662' }}>
              {screenDossierCard.statusLabel === 'Live'
                ? '3 audio moments visible to sponsors, stream only. You control each moment, and every play is logged in your ledger.'
                : 'Complete your Talent Rep screen and approve the draft. Nothing sponsor-visible ships without your sign-off.'}
            </div>
            {screenDossierCard.action && (
              <TapFloorLink href={screenDossierCard.action.href ?? '#'} className={styles.btnGhost} visualHeight={40} style={{ fontSize: 13, fontWeight: 600 }}>
                {screenDossierCard.action.label}
              </TapFloorLink>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 76 }} />
    </div>
  );

  const sponsorMoments = (review.data?.moments ?? []).map((m) => ({
    id: m.id,
    tag: m.tag,
    quote: m.quote,
    durationMs: m.tEndMs - m.tStartMs,
    studentVisible: m.studentVisible,
    struck: m.struck,
  }));
  const sponsorCompetency = (review.data?.dossier?.competency ?? []).map((c) => ({
    name: c.name,
    score: c.score,
    link: c.momentId && c.timestampMs != null ? `moment ${clockLabel(c.timestampMs)}` : 'full transcript',
  }));
  const sponsorMeta = [school, degree, monthYearOf(identity.gradDate), (logisticsChips.find((c) => c.label === 'locations')?.value ?? ''), 'F-1, CPT eligible']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <StudentShell active="profile">{content}</StudentShell>
      {viewSponsor && (
        <div style={{ position: 'fixed', top: 44, left: 'calc(50% + 215px)', zIndex: 20 }}>
          <SponsorPanel
            name={identity.name}
            andrewId={identity.andrewId ?? 'junepark'}
            metaLine={sponsorMeta}
            subLine="Profile refreshed 3 days ago · screen completed Jul 1"
            skills={talentGraph.map((s) => ({ skillId: s.skillId, name: s.name, verified: s.verified, count: s.evidenceIds.length }))}
            expandedSkillId={selected}
            competency={sponsorCompetency}
            moments={sponsorMoments}
          />
        </div>
      )}
    </>
  );
}

// Inline title/link editor for an evidence card (edit mode). Editing re-opens
// verification, so the copy says so.
function InlineEvidenceEdit({
  initialTitle,
  initialUrl,
  pending,
  onSave,
  onCancel,
}: {
  initialTitle: string;
  initialUrl: string;
  pending: boolean;
  onSave: (title: string, url: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const ready = title.trim() && !pending;
  return (
    <div style={{ border: '1.5px solid #90cfea', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: '#f8fbfd' }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ ...FIELD_INPUT, fontSize: 11.5, minHeight: 40 }} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// (optional)" inputMode="url" style={{ ...FIELD_INPUT, fontSize: 11.5, minHeight: 40 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={() => ready && onSave(title.trim(), url)} disabled={!ready} className={ready ? styles.btnDark : styles.btnDisabled} style={{ height: 40, flex: 1, fontSize: 12, fontWeight: 600 }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className={styles.btnGhost} style={{ height: 40, fontSize: 12, fontWeight: 600, padding: '0 12px' }}>Cancel</button>
      </div>
    </div>
  );
}
