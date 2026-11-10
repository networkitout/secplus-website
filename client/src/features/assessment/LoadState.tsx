import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError } from '../../api/client';
import { Button } from '../../ui/Button';

export const pathLink = (
  <Link to="/" className="text-accent underline underline-offset-2">
    Back to path
  </Link>
);

/** What a quiz or exam screen shows while its assessment is loading, or when it could not be loaded. */
export function LoadState({ query, noun }: { query: UseQueryResult<unknown>; noun: 'quiz' | 'exam' }) {
  if (!query.isError) {
    return (
      <p role="status" className="text-muted">
        {`Loading ${noun}…`}
      </p>
    );
  }
  const missing = query.error instanceof ApiError && query.error.status === 404;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{noun === 'quiz' ? 'Quiz' : 'Exam'}</h1>
      <p role="alert">{missing ? `This ${noun} isn't available.` : `Couldn't load this ${noun}.`}</p>
      {!missing && <Button onClick={() => void query.refetch()}>Try again</Button>}
      <p>{pathLink}</p>
    </div>
  );
}
