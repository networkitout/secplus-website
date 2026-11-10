import { z } from 'zod';
import type { Answer, Feedback, Item, PublicQuestion, Question } from '../../../shared/types.js';

export class AnswerShapeError extends Error {}

const id = z.string().min(1);
export const answerSchema: z.ZodType<Answer> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('single'), choice: id }),
  z.object({ type: z.literal('multi'), choices: z.array(id) }),
  z.object({ type: z.literal('order'), order: z.array(id) }),
  z.object({ type: z.literal('match'), pairs: z.record(z.string(), id) }),
  z.object({ type: z.literal('categorize'), placements: z.record(z.string(), id) }),
]);

type Grade = { correct: boolean; fraction: number };

const idSet = (items: Item[]) => new Set(items.map((i) => i.id));

function requireKnown(ids: Iterable<string>, known: Set<string>, what: string): void {
  for (const x of ids) if (!known.has(x)) throw new AnswerShapeError(`unknown ${what} id: ${x}`);
}

function requireNoDuplicates(ids: string[], what: string): void {
  if (new Set(ids).size !== ids.length) throw new AnswerShapeError(`duplicate ${what} id`);
}

/** Share of `correct` entries the learner placed correctly; unplaced entries count as wrong. */
function gradeMap(placed: Record<string, string>, correct: Record<string, string>): Grade {
  const keys = Object.keys(correct);
  const hits = keys.filter((k) => Object.hasOwn(placed, k) && placed[k] === correct[k]).length;
  return { correct: hits === keys.length, fraction: hits / keys.length };
}

export function grade(q: Question, a: Answer): Grade {
  if (a.type !== q.type) throw new AnswerShapeError(`expected ${q.type} answer, got ${a.type}`);
  switch (q.type) {
    case 'single': {
      requireKnown([(a as Extract<Answer, { type: 'single' }>).choice], idSet(q.options), 'option');
      const ok = (a as Extract<Answer, { type: 'single' }>).choice === q.correct;
      return { correct: ok, fraction: ok ? 1 : 0 };
    }
    case 'multi': {
      const { choices } = a as Extract<Answer, { type: 'multi' }>;
      requireNoDuplicates(choices, 'option');
      requireKnown(choices, idSet(q.options), 'option');
      const hits = choices.filter((c) => q.correct.includes(c)).length;
      const wrong = choices.length - hits;
      return {
        correct: hits === q.correct.length && wrong === 0,
        fraction: Math.max(0, hits - wrong) / q.correct.length,
      };
    }
    case 'order': {
      const { order } = a as Extract<Answer, { type: 'order' }>;
      requireNoDuplicates(order, 'item');
      requireKnown(order, idSet(q.items), 'item');
      if (order.length !== q.items.length) throw new AnswerShapeError('order must contain every item');
      const hits = q.correct.filter((x, i) => order[i] === x).length;
      return { correct: hits === q.correct.length, fraction: hits / q.correct.length };
    }
    case 'match': {
      const { pairs } = a as Extract<Answer, { type: 'match' }>;
      requireKnown(Object.keys(pairs), idSet(q.left), 'left');
      requireKnown(Object.values(pairs), idSet(q.right), 'right');
      return gradeMap(pairs, q.correct);
    }
    case 'categorize': {
      const { placements } = a as Extract<Answer, { type: 'categorize' }>;
      requireKnown(Object.keys(placements), idSet(q.items), 'item');
      requireKnown(Object.values(placements), idSet(q.buckets), 'bucket');
      return gradeMap(placements, q.correct);
    }
  }
}

function correctAnswerOf(q: Question): Answer {
  switch (q.type) {
    case 'single': return { type: 'single', choice: q.correct };
    case 'multi': return { type: 'multi', choices: [...q.correct] };
    case 'order': return { type: 'order', order: [...q.correct] };
    case 'match': return { type: 'match', pairs: { ...q.correct } };
    case 'categorize': return { type: 'categorize', placements: { ...q.correct } };
  }
}

export function feedbackFor(q: Question, a: Answer): Feedback {
  const feedback: Feedback = {
    ...grade(q, a),
    correctAnswer: correctAnswerOf(q),
    explanation: q.explanation,
  };
  if (q.type === 'single' || q.type === 'multi') feedback.why = q.why;
  return feedback;
}

/** FNV-1a string hash. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], seed: string): T[] {
  const out = [...list];
  const rand = rng(hash(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function toPublicQuestion(q: Question, seed: string): PublicQuestion {
  const s = seed + q.id;
  const { explanation: _e, ...rest } = q;
  void _e;
  switch (q.type) {
    case 'single':
    case 'multi': {
      const { correct: _c, why: _w, ...pub } = rest as typeof q;
      void _c; void _w;
      return { ...pub, options: shuffle(q.options, s) };
    }
    case 'order': {
      const { correct: _c, ...pub } = rest as typeof q;
      void _c;
      let items = shuffle(q.items, s);
      if (items.every((it, i) => it.id === q.correct[i])) items = [...items.slice(1), items[0]!];
      return { ...pub, items };
    }
    case 'match': {
      const { correct: _c, ...pub } = rest as typeof q;
      void _c;
      return { ...pub, left: shuffle(q.left, s + 'L'), right: shuffle(q.right, s + 'R') };
    }
    case 'categorize': {
      const { correct: _c, ...pub } = rest as typeof q;
      void _c;
      return { ...pub, items: shuffle(q.items, s), buckets: shuffle(q.buckets, s + 'B') };
    }
  }
}
