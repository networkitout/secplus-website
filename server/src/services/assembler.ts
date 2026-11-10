import type { Question } from '../../../shared/types.js';
import type { Content } from '../content/loader.js';

export type Rng = () => number;

/** FNV-1a string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) seeded from a string; returns values in [0, 1). */
export function seededRng(seed: string): Rng {
  let s = hash(seed);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const PASS = { objective: 80, domain: 75, mockScaled: 750 } as const;

/** round(100 + 800 × fraction): the mock exam's 100–900 scale. */
export function scaledScore(fraction: number): number {
  return Math.round(100 + 800 * fraction);
}

/** Least recently seen first (never seen = oldest), ties broken at random; the picks come back shuffled. */
export function pickQuiz(pool: Question[], lastSeen: Map<string, number>, n: number, rng: Rng): string[] {
  const ranked = shuffled(pool, rng)
    .map((q, i) => ({ id: q.id, seen: lastSeen.get(q.id) ?? -Infinity, i }))
    .sort((a, b) => (a.seen === b.seen ? a.i - b.i : a.seen < b.seen ? -1 : 1));
  return shuffled(
    ranked.slice(0, n).map((r) => r.id),
    rng,
  );
}

/** Draws `n` questions spread as evenly as possible across the pools (fewer when the pools run short). */
export function pickSpread(pools: Question[][], lastSeen: Map<string, number>, n: number, rng: Rng): string[] {
  const order = shuffled(
    pools.map((_, i) => i),
    rng,
  );
  const alloc = pools.map(() => 0);
  const target = Math.min(
    n,
    pools.reduce((sum, p) => sum + p.length, 0),
  );
  for (let given = 0; given < target; given++) {
    let best = -1;
    for (const i of order) {
      if (alloc[i]! >= pools[i]!.length) continue;
      if (best === -1 || alloc[i]! < alloc[best]!) best = i;
    }
    alloc[best]!++;
  }
  return pools.flatMap((pool, i) => pickQuiz(pool, lastSeen, alloc[i]!, rng));
}

const PBQ_TYPES = new Set(['order', 'match', 'categorize']);
const MAX_PBQ = 3;

/** Mock exam: each published domain contributes its `mockCount`; up to three PBQ-type questions lead. */
export function pickMock(
  content: Pick<Content, 'manifest' | 'questionsFor'>,
  lastSeen: Map<string, number>,
  rng: Rng,
): { questionIds: string[]; minutes: number; partial: boolean } {
  const byId = new Map<string, Question>();
  const picked: string[] = [];
  let partial = false;
  for (const domain of content.manifest.domains) {
    const pools = domain.objectives.filter((o) => o.published).map((o) => content.questionsFor(o.id));
    if (pools.length === 0) {
      partial = true;
      continue;
    }
    for (const q of pools.flat()) byId.set(q.id, q);
    picked.push(...pickSpread(pools, lastSeen, domain.mockCount, rng));
  }
  const isPbq = (id: string) => PBQ_TYPES.has(byId.get(id)!.type);
  const lead = shuffled(picked.filter(isPbq), rng).slice(0, MAX_PBQ);
  const leading = new Set(lead);
  const rest = shuffled(
    picked.filter((id) => !leading.has(id)),
    rng,
  );
  const questionIds = [...lead, ...rest];
  return { questionIds, minutes: questionIds.length, partial };
}
