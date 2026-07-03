'use client';

import { useState } from 'react';
import { Eye, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { TartanBand, useToast } from '@/components/ui';
import styles from '../student.module.css';
import { StudentShell } from './StudentShell';
import { Avatar, TapFloorLink } from './parts';
import { SponsorPanel } from './SponsorPanel';
import { evidenceState, evidenceCaption, clockLabel } from './format';
import type { EvidenceType } from '@tartan/types';

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

const FIELD_LABEL: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#869db3' };
const FIELD_INPUT: React.CSSProperties = { width: '100%', height: 44, padding: '0 12px', borderRadius: 8, border: '1px solid #c7d2dc', background: '#fff', fontSize: 12.5, color: '#1e1e1e', fontFamily: 'var(--font-ui)' };

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
  const addEvidence = trpc.student.addEvidence.useMutation();

  const [viewSponsor, setViewSponsor] = useState(false);
  // undefined = untouched (defaults to the first skill, like the prototype's
  // initial expandedSkill); null = explicitly deselected (empty state shows).
  const [expandedSkill, setExpandedSkill] = useState<string | null | undefined>(undefined);

  // Add-evidence form state.
  const [addOpen, setAddOpen] = useState(false);
  const [evType, setEvType] = useState<EvidenceType>('repo');
  const [evTitle, setEvTitle] = useState('');
  const [evUrl, setEvUrl] = useState('');
  const [evSkill, setEvSkill] = useState(''); // skill slug or '' (no wiring yet)

  const screenId = data?.screenDossierCard?.screenId;
  const review = trpc.student.screenReview.useQuery(
    { screenId: screenId ?? '' },
    { enabled: viewSponsor && Boolean(screenId) },
  );

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
          toast('Added. Verification is queued.', { durationMs: 2600 });
          // Reveal the new pending item under the skill it was wired to.
          if (wiredSkillId) setExpandedSkill(wiredSkillId);
          setEvTitle('');
          setEvUrl('');
          setEvSkill('');
          setAddOpen(false);
        },
        onError: () => toast('Could not add that. Please try again.', { durationMs: 2600 }),
      },
    );
  };

  const [degree, school] = (identity.program ?? '').split(', ');
  const metaPhone = [school, degree, monthYearOf(identity.gradDate)].filter(Boolean).join(' · ');

  const content = (
    <div style={ROOT}>
      {/* Title + view-as-sponsor toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>Living Profile</div>
        <button
          type="button"
          onClick={() => setViewSponsor((v) => !v)}
          className={`${styles.sponsorToggle} ${viewSponsor ? styles.sponsorToggleActive : ''}`}
        >
          <Eye size={14} strokeWidth={2} />
          View as sponsor
        </button>
      </div>

      {/* Identity card */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar size={52} radius={14} fontSize={18}>{identity.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}</Avatar>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.015em' }}>{identity.name}</div>
            <div style={{ fontSize: 12.5, color: '#4a5662' }}>{metaPhone}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#869db3' }}>{identity.andrewId} · verified via CMU SSO</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {logisticsChips.map((c) => (
            <span key={c.label} style={{ fontSize: 11.5, fontWeight: 500, color: '#4a5662', background: '#f0f4f8', borderRadius: 4, padding: '5px 9px' }}>{c.value}</span>
          ))}
        </div>
      </div>

      {/* Talent Graph */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Talent Graph</div>
          <div style={{ fontSize: 11, color: '#869db3' }}>tap a skill to light its thread</div>
        </div>
        <div style={{ display: 'flex' }}>
          {/* Skill column */}
          <div style={{ width: 120, flex: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {talentGraph.map((s) => {
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
            })}
          </div>
          {/* Elbow connector */}
          <div style={{ width: 16, flex: 'none', borderLeft: '2px solid #90cfea', borderBottom: '2px solid #90cfea', borderRadius: '0 0 0 10px', height: 170, marginTop: 16 }} />
          {/* Evidence column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7, marginLeft: -6, paddingTop: 4 }}>
            {activeSkill ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#0a6b94', paddingLeft: 2 }}>{activeSkill.name}</div>
                {activeSkill.evidenceIds.map((eid) => {
                  const e = evidenceById.get(eid);
                  if (!e) return null;
                  const st = evidenceState(e.type, e.provenance, e.url);
                  const c = EDGE[st]!;
                  return (
                    <div key={eid} style={{ border: `1px ${c.dashed ? 'dashed' : 'solid'} ${c.dashed ? '#c7d2dc' : '#e9ebf8'}`, borderLeft: `3px solid ${c.edge}`, borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3, opacity: c.op, background: '#fff' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.35, color: c.fg }}>{e.title}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: c.capFg }}>{evidenceCaption(e.type, e.provenance, e.url)}</div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{ border: '1px dashed #c7d2dc', borderRadius: 8, padding: 12, marginTop: 14, fontSize: 11, lineHeight: 1.5, color: '#869db3' }}>
                Tap a skill on the left to trace its evidence thread.
              </div>
            )}
          </div>
        </div>
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
      {stories.map((story) => (
        <div key={story.id} style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: 'var(--shadow-resting)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{story.title}</div>
          {([['Setup', story.situation, '#4a5662', false], ['Your part', story.contribution, '#1e1e1e', false], ['Outcome', story.outcome ?? outcomePrompt(story.title), story.outcome ? '#1e1e1e' : '#991a30', !story.outcome]] as const).map(([label, value, color, italic]) => (
            <div key={label} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#869db3', paddingTop: 1 }}>{label}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color, fontStyle: italic ? 'italic' : 'normal' }}>{value}</div>
            </div>
          ))}
        </div>
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
