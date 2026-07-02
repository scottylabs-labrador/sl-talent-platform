// Server-side tRPC caller for React Server Components. Builds a request-scoped
// caller bound to the current session, so an RSC can `await getServerApi()`
// then call procedures directly (no HTTP round-trip).
//
//   const api = await getServerApi();
//   const home = await api.student.home();

import { appRouter } from '@/server/routers/_app';
import { createCallerFactory, createTRPCContext } from '@/server/trpc';

const createCaller = createCallerFactory(appRouter);

export async function getServerApi() {
  return createCaller(await createTRPCContext());
}
