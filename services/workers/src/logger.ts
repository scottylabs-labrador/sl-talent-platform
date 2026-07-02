// Tiny structured console logger. Workers is a private service; console is the
// transport (Railway captures stdout). Keep messages sentence case, no em dashes.

type Extra = Record<string, unknown> | undefined;

function line(level: string, scope: string, msg: string, extra?: Extra): void {
  const ts = new Date().toISOString();
  const base = `${ts} [${level}] [workers:${scope}] ${msg}`;
  if (extra && Object.keys(extra).length > 0) {
    // eslint-disable-next-line no-console
    console.log(base, JSON.stringify(extra));
  } else {
    // eslint-disable-next-line no-console
    console.log(base);
  }
}

export const log = {
  info: (scope: string, msg: string, extra?: Extra): void =>
    line('info', scope, msg, extra),
  warn: (scope: string, msg: string, extra?: Extra): void =>
    line('warn', scope, msg, extra),
  error: (scope: string, msg: string, extra?: Extra): void =>
    line('error', scope, msg, extra),
};
