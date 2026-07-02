// Login. Continue with Google (ink primary) plus, when DEV_LOGIN is on, three
// seeded demo accounts. Sign-in runs through server actions calling the
// Auth.js signIn(); the root page then routes each principal to its home.

import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { Card, BrandGlyph, Pill } from '@/components/ui';
import styles from './login.module.css';

/** Multi-color Google "G", inline (self-contained, no external asset). */
function GoogleG() {
  return (
    <svg className={styles.googleG} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user?.userId) redirect('/');

  const { callbackUrl } = await searchParams;
  const redirectTo = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/';
  const devLogin = process.env.DEV_LOGIN === 'true';

  async function googleSignIn() {
    'use server';
    await signIn('google', { redirectTo });
  }
  async function demoSignIn(email: string) {
    'use server';
    await signIn('demo', { email, redirectTo });
  }

  return (
    <main className={styles.screen}>
      <Card className={styles.card}>
        <BrandGlyph size={44} className={styles.glyph} />
        <h1 className={styles.title}>ScottyLabs Talent</h1>
        <p className={styles.subtitle}>Evidence beats claims.</p>

        <div className={styles.actions}>
          <form action={googleSignIn} className={styles.form}>
            <Pill type="submit" variant="primary" block leading={<GoogleG />}>
              Continue with Google
            </Pill>
          </form>
        </div>

        <p className={styles.microcopy}>
          CMU students sign in with an andrew.cmu.edu account.
        </p>

        {devLogin && (
          <>
            <div className={styles.divider}>Demo accounts</div>
            <div className={styles.actions}>
              <form
                action={demoSignIn.bind(null, 'student@demo.tartan')}
                className={styles.form}
              >
                <Pill type="submit" variant="secondary" block>
                  Student demo
                </Pill>
              </form>
              <form
                action={demoSignIn.bind(null, 'sponsor@demo.tartan')}
                className={styles.form}
              >
                <Pill type="submit" variant="secondary" block>
                  Sponsor demo (Scogle)
                </Pill>
              </form>
              <form
                action={demoSignIn.bind(null, 'ops@demo.tartan')}
                className={styles.form}
              >
                <Pill type="submit" variant="secondary" block>
                  Ops demo
                </Pill>
              </form>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
