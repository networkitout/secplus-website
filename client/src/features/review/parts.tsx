import { Link } from 'react-router';
import type { ReviewCard, ReviewResponse } from '../../api/types';

/** The number of Leitner boxes; a card in the last one has nowhere higher to go. */
export const BOXES = 5;

export const pathLink = (
  <Link to="/" className="text-accent underline underline-offset-2">
    Back to path
  </Link>
);

export const cardUrl = (card: ReviewCard) => `review/${encodeURIComponent(card.cardId)}`;

export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A card of the round that the server has moved, with its response. */
export type ReviewedCard = { cardId: string } & ReviewResponse;

export type CardProps<C extends ReviewCard> = {
  card: C;
  /** The server has moved the card: called once, with its response. */
  onReviewed(card: ReviewCard, res: ReviewResponse): void;
  /** On to the next card. Does nothing when the round has already moved past this card. */
  onNext(): void;
  /** Leaves the card unreviewed. `stillDue`: the server still holds it as due today. */
  onSkip(stillDue: boolean): void;
};
