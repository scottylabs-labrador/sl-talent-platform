// Auth.js v5 route handler. Wires GET/POST for every next-auth endpoint
// (callback, signin, signout, session, csrf, providers).
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
