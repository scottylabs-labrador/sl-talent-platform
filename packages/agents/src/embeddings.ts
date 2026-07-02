// Embeddings. OpenRouter is chat-focused, so embeddings are called directly
// against an OpenAI-compatible endpoint (ARCHITECTURE section 6). 1536 dims to
// match the pgvector columns. When EMBEDDINGS_API_KEY is unset we return a
// deterministic pseudo-embedding (seeded hash -> unit vector) so pgvector
// queries still return sane, stable neighbors in demos and tests.

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDINGS_URL =
  process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1/embeddings';

let stubWarned = false;

/** FNV-1a 32-bit hash of a string; the seed for the deterministic stub. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic unit vector seeded by the text. Same text -> same vector. */
export function stubEmbedding(text: string): number[] {
  const rand = mulberry32(fnv1a(text) || 1);
  const v = new Array<number>(EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
    // Box-Muller-ish spread around 0 so cosine distances are meaningful.
    const x = rand() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) v[i] = v[i]! / norm;
  return v;
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Embed a batch of texts to 1536-dim vectors. Real call when EMBEDDINGS_API_KEY
 * is set; deterministic stub otherwise. Order of the returned vectors matches
 * the input order.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const key = process.env.EMBEDDINGS_API_KEY;
  if (!key) {
    if (!stubWarned) {
      stubWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[embeddings] EMBEDDINGS_API_KEY unset — using deterministic stub embeddings.',
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
