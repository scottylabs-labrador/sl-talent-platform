// The root tRPC router. Composes the three principal routers. `AppRouter` is
// the single type the typed client (lib/trpc/client) and the RSC caller
// (lib/trpc/server) consume.

import { router } from '../trpc';
import { studentRouter } from './student';
import { sponsorRouter } from './sponsor';
import { opsRouter } from './ops';

export const appRouter = router({
  student: studentRouter,
  sponsor: sponsorRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;
