import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Answer, Feedback } from '../../../../shared/types.js';
import { requireAuth } from '../../http.js';
import { AnswerShapeError, answerSchema, feedbackFor, grade, toPublicQuestion } from '../../services/scoring.js';
import { dueOn, nextBox } from '../../services/leitner.js';
import { localDate, safeTimeZone } from '../../services/time.js';
import { XP } from '../../services/xp.js';
import { awardXp, evaluateBadges } from '../xp/repo.js';
import { cardExists, dueCards, findCard, moveCard, nextDueOn } from './repo.js';

const DUE_LIMIT = 30;
const questionBody = z.object({ answer: answerSchema }).strict();
const flashcardBody = z.object({ knewIt: z.boolean() }).strict();

export function reviewRouter(deps: AppDeps): Router {
  const { db, content, now } = deps;
  const router = Router();
  router.use(requireAuth);

  router.get('/due', async (req, res) => {
    const user = req.user!;
    const today = localDate(now(), user.timeZone);
    const [due, next] = await Promise.all([dueCards(db, content, user.id, today), nextDueOn(db, content, user.id, today)]);
    const cards = due.slice(0, DUE_LIMIT).map((c) => {
      if (c.cardId.startsWith('q:')) {
        const q = content.questions.get(c.cardId.slice(2))!;
        return { cardId: c.cardId, kind: 'question' as const, question: toPublicQuestion(q, `${user.id}:${c.cardId}:${today}`) };
      }
      const f = content.flashcards.find((x) => x.id === c.cardId.slice(2))!;
      return { cardId: c.cardId, kind: 'flashcard' as const, term: f.term };
    });
    res.json({ total: due.length, cards, nextDueOn: next });
  });

  router.get('/flashcard/:cardId', async (req, res) => {
    const cardId = String(req.params.cardId);
    const card = cardId.startsWith('f:') && cardExists(content, cardId) ? await findCard(db, req.user!.id, cardId) : undefined;
    if (!card) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }
    const f = content.flashcards.find((x) => x.id === cardId.slice(2))!;
    res.json({ definition: f.definition });
  });

  router.post('/:cardId', async (req, res) => {
    const user = req.user!;
    const cardId = String(req.params.cardId);
    const t = now();
    const today = localDate(t, user.timeZone);

    const card = cardExists(content, cardId) ? await findCard(db, user.id, cardId) : undefined;
    if (!card) {
      res.status(404).json({ error: 'Card not found' });
      return;
    }
    if (card.dueOn > today) {
      res.status(409).json({ error: 'This card is not due yet' });
      return;
    }

    let correct: boolean;
    let feedback: Feedback | undefined;
    let definition: string | undefined;
    let questionId: string | undefined;
    let xpAmount: number;
    let xpReason: string;

    if (cardId.startsWith('q:')) {
      const body = questionBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid request' });
        return;
      }
      questionId = cardId.slice(2);
      const q = content.questions.get(questionId)!;
      const answer: Answer = body.data.answer;
      try {
        correct = grade(q, answer).correct;
        feedback = feedbackFor(q, answer);
      } catch (err) {
        if (err instanceof AnswerShapeError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }
      xpAmount = XP.repeatCorrect;
      xpReason = 'repeat-correct';
    } else {
      const body = flashcardBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: body.error.issues[0]?.message ?? 'Invalid request' });
        return;
      }
      correct = body.data.knewIt;
      definition = content.flashcards.find((x) => x.id === cardId.slice(2))!.definition;
      xpAmount = XP.flashcardKnown;
      xpReason = 'flashcard';
    }

    const box = nextBox(card.box, correct);
    const due = dueOn(box, today);
    if (!(await moveCard(db, user.id, card, box, due, today))) {
      res.status(409).json({ error: 'This card is not due yet' });
      return;
    }
    if (questionId) {
      await db.exec('INSERT INTO attempts (user_id, question_id, correct, context, created_at) VALUES (?, ?, ?, ?, ?)', [
        user.id,
        questionId,
        correct ? 1 : 0,
        'review',
        t,
      ]);
    }
    let xp = 0;
    if (correct && (await awardXp(db, { userId: user.id, amount: xpAmount, reason: xpReason, ref: `${cardId}@${today}`, now: t }))) {
      xp = xpAmount;
    }
    // After the writes, as for any other answer: a review can complete a streak or the hundredth correct attempt.
    // The review is already recorded, so a failure here must not fail the request: a retry would get a 409.
    // The next evaluation awards whatever this one missed.
    let newBadges: string[] = [];
    try {
      newBadges = await evaluateBadges(db, user.id, safeTimeZone(user.timeZone), t);
    } catch (err) {
      console.error(err);
    }
    res.json({
      box,
      previousBox: card.box,
      dueOn: due,
      ...(feedback && { feedback }),
      ...(definition !== undefined && { definition }),
      xp,
      newBadges,
    });
  });

  return router;
}
