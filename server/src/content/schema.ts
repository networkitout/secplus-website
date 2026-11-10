import { z } from 'zod';

const nonEmpty = z.string().min(1);
const item = z.object({ id: nonEmpty, text: nonEmpty });
const items = z.array(item).min(2);
const idMap = z.record(z.string(), nonEmpty);

const base = {
  id: nonEmpty,
  objective: nonEmpty,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prompt: nonEmpty,
  explanation: nonEmpty,
};

export const questionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('single'),
    options: items,
    correct: nonEmpty,
    why: idMap,
  }),
  z.object({
    ...base,
    type: z.literal('multi'),
    options: items,
    correct: z.array(nonEmpty).min(1),
    why: idMap,
  }),
  z.object({ ...base, type: z.literal('order'), items, correct: z.array(nonEmpty).min(2) }),
  z.object({ ...base, type: z.literal('match'), left: items, right: items, correct: idMap }),
  z.object({ ...base, type: z.literal('categorize'), items, buckets: items, correct: idMap }),
]);

export const questionsFileSchema = z.array(questionSchema);

export const labSchema = z.object({
  id: nonEmpty,
  domain: z.number().int().min(1),
  objectives: z.array(nonEmpty).min(1),
  title: nonEmpty,
  scenario: nonEmpty,
  steps: z.array(questionSchema).min(1),
});

export const flashcardSchema = z.object({
  id: nonEmpty,
  objective: nonEmpty,
  term: nonEmpty,
  definition: nonEmpty,
});
export const flashcardsFileSchema = z.array(flashcardSchema);

export const manifestSchema = z.object({
  exam: z.literal('SY0-701'),
  domains: z
    .array(
      z.object({
        id: z.number().int().min(1),
        title: nonEmpty,
        weight: z.number(),
        mockCount: z.number().int().min(0),
        objectives: z.array(
          z.object({
            id: nonEmpty,
            title: nonEmpty,
            published: z.boolean(),
            minQuestions: z.number().int().min(0),
          }),
        ),
      }),
    )
    .min(1),
});
