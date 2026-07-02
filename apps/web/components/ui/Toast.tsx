'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import styles from './Toast.module.css';

/** Canonical dismiss (Ops). Student surface uses 2600, sponsor 3000. */
const DEFAULT_DISMISS_MS = 2800;

interface ToastState {
  id: number;
  message: string;
}

interface ToastApi {
  /** Show a toast. Replaces any current toast (one at a time). */
  toast: (message: string, opts?: { durationMs?: number }) => void;
  /** Dismiss the current toast immediately. */
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setCurrent(null);
  }, [clearTimer]);

  const toast = useCallback(
    (message: string, opts?: { durationMs?: number }) => {
      clearTimer();
      const id = ++seq.current;
      setCurrent({ id, message });
      timer.current = setTimeout(
        () => setCurrent((c) => (c && c.id === id ? null : c)),
        opts?.durationMs ?? DEFAULT_DISMISS_MS,
      );
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {current && (
        <div className={styles.viewport} role="status" aria-live="polite">
          {/* key forces the entrance animation to replay on replace */}
          <div key={current.id} className={styles.toast}>
            {current.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Access the toast API. Must be under <ToastProvider>. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}
