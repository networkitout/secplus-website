import type { Content } from '../../content/loader.js';
import type { Db } from '../../db/db.js';
import { dueOn } from '../../services/leitner.js';

export type ReviewCard = { cardId: string; box: number; dueOn: string };

/** A missed question goes (back) to box 1, due tomorrow. */
export async function scheduleMiss(db: Db, userId: number, cardId: string, today: string): Promise<void> {
  await db.exec(
    `INSERT INTO review_cards (user_id, card_id, box, due_on) VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE box = 1, due_on = VALUES(due_on)`,
    [userId, cardId, dueOn(1, today)],
  );
}

/** Adds flashcards in box 1, due today; cards the learner already has are left alone. */
export async function addFlashcards(db: Db, userId: number, flashcardIds: string[], today: string): Promise<void> {
  for (const id of flashcardIds) {
    await db.exec('INSERT IGNORE INTO review_cards (user_id, card_id, box, due_on) VALUES (?, ?, 1, ?)', [
      userId,
      `f:${id}`,
      today,
    ]);
  }
}

/** True when the card's question or flashcard still exists in content. */
export function cardExists(content: Content, cardId: string): boolean {
  if (cardId.startsWith('q:')) return content.questions.has(cardId.slice(2));
  if (cardId.startsWith('f:')) return content.flashcards.some((f) => f.id === cardId.slice(2));
  return false;
}

/** Cards due on or before `today`, oldest first, skipping cards whose content is gone. */
export async function dueCards(db: Db, content: Content, userId: number, today: string): Promise<ReviewCard[]> {
  const rows = await db.query<{ card_id: string; box: number; due_on: string }>(
    `SELECT card_id, box, due_on FROM review_cards WHERE user_id = ? AND due_on <= ? ORDER BY due_on, card_id`,
    [userId, today],
  );
  return rows
    .filter((r) => cardExists(content, r.card_id))
    .map((r) => ({ cardId: r.card_id, box: Number(r.box), dueOn: r.due_on }));
}

export async function dueCount(db: Db, content: Content, userId: number, today: string): Promise<number> {
  return (await dueCards(db, content, userId, today)).length;
}

export async function findCard(db: Db, userId: number, cardId: string): Promise<ReviewCard | undefined> {
  const rows = await db.query<{ card_id: string; box: number; due_on: string }>(
    'SELECT card_id, box, due_on FROM review_cards WHERE user_id = ? AND card_id = ?',
    [userId, cardId],
  );
  const r = rows[0];
  return r && { cardId: r.card_id, box: Number(r.box), dueOn: r.due_on };
}

/** Moves a due card to its new box; false when it changed or was not due in the meantime. */
export async function moveCard(
  db: Db,
  userId: number,
  card: ReviewCard,
  newBox: number,
  newDue: string,
  today: string,
): Promise<boolean> {
  const res = await db.exec(
    'UPDATE review_cards SET box = ?, due_on = ? WHERE user_id = ? AND card_id = ? AND box = ? AND due_on <= ?',
    [newBox, newDue, userId, card.cardId, card.box, today],
  );
  return res.affectedRows === 1;
}
