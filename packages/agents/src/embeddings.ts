// Embeddings. OpenRouter is chat-focused, so embeddings are called directly
// against an OpenAI-compatible endpoint (ARCHITECTURE section 6). 1536 dims to
// match the pgvector columns. When EMBEDDINGS_API_KEY is set we call the real
// provider (OpenAI text-embedding-3-small). When it is unset we compute a
// deterministic, dependency-free CONTENT embedding: a feature-hashed bag of
// words/bigrams with sublinear TF weighting, L2-normalized. This is a real
// lexical embedding (not noise): two profiles about "distributed systems / Go /
// Raft" land near each other in cosine space, a systems profile and a pure-ML
// profile land far apart. pgvector retrieval over real content stays meaningful.

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDINGS_URL =
  process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1/embeddings';

let localWarned = false;

/** FNV-1a 32-bit hash with a seed, so one token can map to several buckets. */
function fnv1a(str: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via Math.imul to stay in integer range.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Common English + résumé filler words that carry little discriminative signal.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'was', 'are', 'has', 'had',
  'have', 'from', 'you', 'your', 'our', 'not', 'but', 'all', 'any', 'can',
  'will', 'they', 'them', 'their', 'his', 'her', 'its', 'who', 'what', 'when',
  'where', 'which', 'into', 'over', 'under', 'about', 'than', 'then', 'been',
  'were', 'would', 'could', 'should', 'also', 'such', 'each', 'other', 'some',
  'more', 'most', 'using', 'used', 'use', 'via', 'per', 'inc', 'llc',
]);

/** Lowercase, split on non-alphanumerics, drop stop words and 1-char tokens. */
function tokenize(text: string): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length < 2) continue;
    if (STOP_WORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

// Number of independent hash seeds each feature spreads across. More seeds =>
// lower collision variance at the cost of a little density.
const HASH_SEEDS = [0, 0x9e3779b1, 0x85ebca77] as const;

/**
 * Deterministic content embedding via the hashing trick (Weinberger et al.):
 * each feature is hashed into a dimension with one hash and given a sign with
 * another, so inner products are unbiased despite collisions. Unigrams and
 * adjacent bigrams both contribute; TF is weighted sublinearly (1 + log tf);
 * the final vector is L2-normalized so cosine similarity reflects overlap.
 * Same text -> same vector; overlapping vocabularies -> high cosine.
 */
export function stubEmbedding(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  // Build features: unigrams + adjacent bigrams, counted for TF.
  const counts = new Map<string, number>();
  const bump = (f: string) => counts.set(f, (counts.get(f) ?? 0) + 1);
  for (let i = 0; i < tokens.length; i++) {
    bump(tokens[i]!);
    if (i + 1 < tokens.length) bump(`${tokens[i]}_${tokens[i + 1]}`);
  }
  if (counts.size === 0) return v; // no content -> zero vector

  for (const [feature, tf] of counts) {
    // Sublinear TF: repeats matter, but with diminishing weight.
    const weight = 1 + Math.log(tf);
    for (const seed of HASH_SEEDS) {
      const h = fnv1a(feature, seed);
      const idx = h % EMBEDDING_DIMENSIONS;
      // A separate high bit picks the sign so collisions cancel in expectation.
      const sign = (h & 0x80000000) !== 0 ? -1 : 1;
      v[idx]! += sign * weight;
    }
  }

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) v[i] = v[i]! / norm;
  return v;
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Embed a batch of texts to 1536-dim vectors. Real provider call when
 * EMBEDDINGS_API_KEY is set; deterministic local content embedding otherwise.
 * Order of the returned vectors matches the input order.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const key = process.env.EMBEDDINGS_API_KEY;
  if (!key) {
    if (!localWarned) {
      localWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[embeddings] EMBEDDINGS_API_KEY unset — using local deterministic content embeddings (feature-hashed bag of words).',
      );
    }
    return texts.map(stubEmbedding);
  }

  const res = await fetch(EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: process.env.EMBEDDINGS_MODEL ?? EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Embeddings request failed: ${res.status} ${res.statusText} ${body}`.trim(),
    );
  }

  const json = (await res.json()) as OpenAIEmbeddingResponse;
  // Sort by index defensively; the API returns in order but do not assume.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Convenience for a single text. */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec ?? stubEmbedding(text);
}
