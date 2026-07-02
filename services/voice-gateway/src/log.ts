// Tiny structured logger. No dependency; JSON-ish lines so Railway log search
// works. DEBUG=1 enables debug lines.

type Level = 'info' | 'warn' | 'error' | 'debug';

function emit(level: Level, msg: string, meta?: unknown): void {
  const prefix = `[voice-gateway] ${level}`;
  const extra = meta === undefined ? '' : meta;
  if (level === 'error') console.error(prefix, msg, extra);
  else if (level === 'warn') console.warn(prefix, msg, extra);
  else console.log(prefix, msg, extra);
}

export const log = {
  info: (msg: string, meta?: unknown): void => emit('info', msg, meta),
  warn: (msg: string, meta?: unknown): void => emit('warn', msg, meta),
  error: (msg: string, meta?: unknown): void => emit('error', msg, meta),
  debug: (msg: string, meta?: unknown): void => {
    if (process.env.DEBUG) emit('debug', msg, meta);
  },
};
