import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Button } from './Button';

/**
 * What a page says about its main query when there is something to say: that it is loading, that it could
 * not be loaded, or that what is on screen could not be refreshed and may be out of date. Render it above
 * the content, whether or not there is data. `what` completes "Loading …" and "Couldn't load …".
 *
 * A network or 503 failure without data does not arrive here: it goes to the top-level error screen.
 */
export function QueryStatus({ query, what }: { query: UseQueryResult<unknown>; what: string }) {
  const box = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const failed = query.isError;
  const hasData = query.data !== undefined;

  // "Try again" worked and its button is gone: focus stays here instead of falling back to the document.
  useEffect(() => {
    if (failed || !retried.current) return;
    retried.current = false;
    if (document.activeElement === document.body) box.current?.focus();
  }, [failed]);

  function retry() {
    retried.current = true;
    void query.refetch();
  }

  return (
    <div ref={box} tabIndex={-1} className="rounded-sm">
      {failed ? (
        <div className={`flex flex-wrap items-center gap-3 ${hasData ? 'rounded-md border border-warn px-3 py-2 text-sm' : ''}`}>
          {hasData ? (
            <p role="status">{`Couldn't refresh ${what}. What you see may be out of date.`}</p>
          ) : (
            <p role="alert">{`Couldn't load ${what}.`}</p>
          )}
          <Button variant={hasData ? 'secondary' : 'primary'} aria-busy={query.isFetching || undefined} onClick={retry}>
            {query.isFetching ? 'Trying again…' : 'Try again'}
          </Button>
        </div>
      ) : (
        !hasData && (
          <p role="status" className="text-muted">
            {`Loading ${what}…`}
          </p>
        )
      )}
    </div>
  );
}
