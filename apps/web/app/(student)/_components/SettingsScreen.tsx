'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import type { Visibility } from '@tartan/types';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/components/ui';
import styles from '../student.module.css';
import { ledgerChip, ledgerWhen } from './format';

const ROOT: React.CSSProperties = { padding: '64px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 };

const VIS_OPTIONS: { id: Visibility; label: string; display: string; desc: string }[] = [
  { id: 'searchable', label: 'Searchable', display: 'searchable', desc: 'All 10 Premier sponsors can find you. Every view is logged here.' },
  { id: 'match_only', label: 'Match only', display: 'match-only', desc: 'Invisible until shortlisted, then we ask you before revealing identity.' },
  { id: 'paused', label: 'Paused', display: 'paused', desc: 'Nothing new is shown to anyone. Existing intros stay open.' },
];

export function SettingsScreen() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const profile = trpc.student.profile.useQuery();
  const ledger = trpc.student.ledger.useQuery({ limit: 50 });
  const updateVisibility = trpc.student.updateVisibility.useMutation();
  const exportData = trpc.student.exportData.useMutation();
  const deleteAccount = trpc.student.deleteAccount.useMutation();

  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportRequested, setExportRequested] = useState(false);

  // Poll the export status while an archive is being prepared; the worker
  // flips the same key to ready with a 24h download link.
  const exportStatus = trpc.student.exportStatus.useQuery(undefined, {
    refetchInterval: (q) =>
      q.state.data?.state === 'pending' || exportRequested ? 4000 : false,
  });
  const exportReady = exportStatus.data?.state === 'ready' && exportStatus.data.url;

  const current = visibility ?? profile.data?.visibility ?? 'searchable';

  const pickVisibility = (opt: (typeof VIS_OPTIONS)[number]) => {
    setVisibility(opt.id);
    updateVisibility.mutate(
      { visibility: opt.id },
      { onSuccess: () => { void utils.student.profile.invalidate(); void utils.student.ledger.invalidate(); } },
    );
    toast(`Visibility set to ${opt.display}. Effective now, including the MCP layer.`, { durationMs: 2600 });
  };

  const doExport = () => {
    exportData.mutate(undefined, {
      onSuccess: () => {
        setExportRequested(true);
        void utils.student.ledger.invalidate();
        void utils.student.exportStatus.invalidate();
      },
    });
    toast('Export started. The download link appears here when it is ready.', { durationMs: 2600 });
  };

  const doDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteAccount.mutate(
      { confirm: true },
      { onSuccess: () => void signOut({ callbackUrl: '/login' }) },
    );
    toast('Account deletion scheduled. Signing you out.', { durationMs: 2600 });
  };

  return (
    <div style={ROOT}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>You and your data</div>

      {/* Visibility */}
      <div style={{ fontSize: 13, fontWeight: 600, padding: '0 2px' }}>Visibility</div>
      {VIS_OPTIONS.map((opt) => {
        const selected = current === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => pickVisibility(opt)}
            style={{ display: 'flex', gap: 11, alignItems: 'flex-start', textAlign: 'left', borderRadius: 12, padding: '13px 14px', cursor: 'pointer', background: selected ? '#e7f5fa' : '#fff', border: `1.5px solid ${selected ? '#0e96d1' : '#c7d2dc'}` }}
          >
            <span style={{ width: 18, height: 18, borderRadius: '50%', border: `1.75px solid ${selected ? '#0e96d1' : '#aebdcc'}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', marginTop: 1 }}>
              {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#0e96d1' }} />}
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: '#1e1e1e' }}>{opt.label}</span>
              <span style={{ display: 'block', fontSize: 12, lineHeight: 1.5, color: '#4a5662' }}>{opt.desc}</span>
            </span>
          </button>
        );
      })}

      {/* Data ledger */}
      <div style={{ background: '#fff', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 2, boxShadow: 'var(--shadow-resting)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Data Ledger</div>
          <div style={{ fontSize: 11, color: '#869db3' }}>every access, logged</div>
        </div>
        {(ledger.data?.entries ?? []).map((row) => {
          const chip = ledgerChip(row.eventKind, row.actorLabel);
          return (
            <div key={row.id} style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #e9ebf8', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', borderRadius: 4, padding: '3px 7px', minWidth: 34, textAlign: 'center', background: chip.bg, color: chip.fg, flex: 'none' }}>{chip.kindWord}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#1e1e1e' }}>{row.detail.note ?? chip.kindWord}</div>
                <div style={{ fontSize: 11, color: '#869db3' }}>{ledgerWhen(row.createdAt)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Data actions */}
      {exportReady ? (
        <a
          href={exportStatus.data!.url}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 100, background: '#e7f5fa', border: '1px solid #90cfea', color: '#0a6b94', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}
        >
          Download your data (link expires in 24 hours)
        </a>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={doExport} className={styles.btnGhost} style={{ flex: 1, height: 44, fontSize: 12.5, fontWeight: 600 }}>
          {exportRequested && !exportReady ? 'Preparing your archive…' : 'Export everything'}
        </button>
        <button
          type="button"
          onClick={doDelete}
          style={{ flex: 1, height: 44, borderRadius: 100, border: '1px solid #f3bbc5', background: confirmDelete ? '#fdf2f4' : '#fff', color: '#c4213e', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          {confirmDelete ? 'Tap again to confirm' : 'Delete account, for real'}
        </button>
      </div>

      {/* Session */}
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: '/login' })}
        style={{ height: 44, borderRadius: 100, border: '1px solid #c7d2dc', background: '#fff', color: '#1e1e1e', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
      >
        Sign out
      </button>

      <div style={{ height: 76 }} />
    </div>
  );
}
