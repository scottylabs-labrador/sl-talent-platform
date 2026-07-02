// voice-gateway entrypoint — realtime WebSocket service: browser audio in,
// Cartesia + OpenRouter out (ARCHITECTURE section 5). Boot with the symlinked
// env, e.g.  node --env-file=.env dist/index.js  (or `tsx src/index.ts`).

import './load-env.js'; // must be first: loads .env before ./config reads env
import { createGateway } from './server.js';

createGateway().start();
