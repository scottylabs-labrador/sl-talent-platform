// @tartan/agents — runAgent OpenRouter client with agent_runs logging,
// per-agent model routing, structured outputs derived from the same zod schemas
// the app uses, deterministic stub mode, embeddings, versioned prompts, and the
// deterministic intake policy guard.

export const AGENTS_PACKAGE = '@tartan/agents';

export * from './client.js';
export * from './embeddings.js';
export * from './guards.js';
export * from './prompts.js';
export * from './stubs.js';
export * from './resume.js';
