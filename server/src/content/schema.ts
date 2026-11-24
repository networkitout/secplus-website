import { z } from 'zod';

const nonEmpty = z.string().min(1);
const item = z.object({ id: nonEmpty, text: nonEmpty });
const items = z.array(item).min(2);
const idMap = z.record(z.string(), nonEmpty);

// Ids are stored in the database, so each is capped at what its column holds (001_init.sql).
/** A question or lab step: `attempts.question_id` VARCHAR(40); its review card `q:<id>` fits `card_id` VARCHAR(48). */
const questionId = nonEmpty.max(40);
/** `review_cards.card_id` VARCHAR(48) holds `f:<id>`. */
const flashcardId = nonEmpty.max(46);
/** `lab_results.lab_id` VARCHAR(40). */
const labId = nonEmpty.max(40);
/** `assessments.scope` VARCHAR(8) holds it for an objective quiz (`lesson_progress.objective` has 16). */
const objectiveId = nonEmpty.max(8);

const base = {
  id: questionId,
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
  // At least three: a two-item list is always served swapped (see toPublicQuestion), which gives the order away.
  z.object({ ...base, type: z.literal('order'), items: z.array(item).min(3), correct: z.array(nonEmpty).min(3) }),
  z.object({ ...base, type: z.literal('match'), left: items, right: items, correct: idMap }),
  z.object({ ...base, type: z.literal('categorize'), items, buckets: items, correct: idMap }),
]);

export const questionsFileSchema = z.array(questionSchema);

export const labSchema = z.object({
  id: labId,
  domain: z.number().int().min(1),
  objectives: z.array(nonEmpty).min(1),
  title: nonEmpty,
  scenario: nonEmpty,
  steps: z.array(questionSchema).min(1),
});

export const flashcardSchema = z.object({
  id: flashcardId,
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
            id: objectiveId,
            title: nonEmpty,
            published: z.boolean(),
            minQuestions: z.number().int().min(0),
          }),
        ),
      }),
    )
    .min(1),
});
