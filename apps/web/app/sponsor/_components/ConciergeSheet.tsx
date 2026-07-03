'use client';

// The Concierge chat sheet: a right-side overlay sheet wired to
// sponsor.conciergeMessage (live claude-sonnet, grounded on the sponsor's
// licensed-scope digest). Opened from the header "Ask the Concierge" pill and
// from the dashboard card's suggestion chips (which open it prefilled). Chat
// state is client-side, per session (it resets on reload). Bubble styles mirror
// the intake conversation.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import { X } from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { BrandGlyph } from '@/components/ui';
import styles from './ConciergeSheet.module.css';

interface ConciergeCtx {
  /** Open the sheet, optionally prefilling the composer. */
  open: (prefill?: string) => void;
}

const Ctx = createContext<ConciergeCtx | null>(null);

export function useConcierge(): ConciergeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useConcierge must be used within a ConciergeProvider');
  return c;
}

// Generic starter prompts (no fabricated role or candidate specifics). The
// Concierge answers each from the licensed-scope digest of real rows.
const SUGGESTIONS = [
  'How many students graduate in May?',
  'Which shortlisted candidates are alumni?',
  'What is trainable for my role versus a hard filter?',
];

interface Bubble {
  role: 'user' | 'assistant';
  content: string;
}

export function ConciergeProvider({
  orgName,
  children,
}: {
  orgName?: string;
  children: ReactNode;
}) {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [text, setText] = useState('');
  const concierge = trpc.sponsor.conciergeMessage.useMutation();

  // Author label for the member's turns, from the real member + org.
  const firstName = session?.user?.name?.split(' ')[0] ?? null;
  const meLabel =
    firstName && orgName ? `${firstName} @ ${orgName}` : firstName ?? 'You';
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const open = (prefill?: string) => {
    setIsOpen(true);
    if (prefill) setText(prefill);
  };
  const close = () => setIsOpen(false);

  // Autoscroll to the newest bubble.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, concierge.isPending]);

  // Escape to close; focus the composer on open.
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const send = async () => {
    const message = text.trim();
    if (!message || concierge.isPending) return;
    setText('');
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);
    try {
      const res = await concierge.mutateAsync({ message, history });
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'I could not reach the pool just now. Give me a moment and try again.',
        },
      ]);
    }
  };

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {isOpen && (
        <div className={styles.overlay} onClick={close}>
          <div
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label="Ask the Concierge"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <BrandGlyph size={30} inset={false} />
                <div className={styles.headerTextCol}>
                  <span className={styles.headerName}>Concierge</span>
                  <span className={styles.headerCaption}>
                    reads anything you are licensed to see · commitments get
                    drafted for a human
                  </span>
                </div>
              </div>
              <button
                className={styles.close}
                onClick={close}
                aria-label="Close"
              >
                <X width={15} height={15} strokeWidth={2} />
              </button>
            </div>

            <div className={styles.messages} ref={scrollRef}>
              {messages.length === 0 && (
                <div className={styles.empty}>
                  <p className={styles.emptyText}>
                    Ask about your roles, your delivered shortlists, or the pool.
                    Try one:
                  </p>
                  <div className={styles.chipsRow}>
                    {SUGGESTIONS.map((s, i) => (
                      <button
                        key={i}
                        className={styles.suggestChip}
                        onClick={() => {
                          setText(s);
                          inputRef.current?.focus();
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`${styles.message} ${
                    m.role === 'user' ? styles.msgMe : styles.msgConcierge
                  }`}
                >
                  <span className={styles.who}>
                    {m.role === 'user' ? meLabel : 'Concierge'}
                  </span>
                  <div
                    className={`${styles.bubble} ${
                      m.role === 'user' ? styles.bubbleMe : styles.bubbleConcierge
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {concierge.isPending && (
                <div className={`${styles.message} ${styles.msgConcierge}`}>
                  <span className={styles.who}>Concierge</span>
                  <div className={`${styles.bubble} ${styles.bubbleConcierge}`}>
                    Reading your scope…
                  </div>
                </div>
              )}
            </div>

            <div className={styles.composer}>
              <input
                ref={inputRef}
                className={styles.input}
                value={text}
                placeholder="Ask the Concierge"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void send();
                }}
              />
              <button
                className={styles.sendBtn}
                onClick={() => void send()}
                disabled={concierge.isPending}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
