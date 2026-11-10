import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Button } from './Button';

/**
 * What a page says about its main query when there is something to say: that it is loading, that it waits
 * for the connection, that it could not be loaded, or that what is on screen could not be refreshed and
 * may be out of date. Render it above the content, whether or not there is data. `what` completes
 * "Loading …" and "Couldn't load …".
 *
 * Rows that a query only keeps on screen from its previous key (placeholder data) are not its own: it
 * counts as loading.
 *
 * A network or 503 failure without data does not arrive here, but at the top-level error screen, unless
 * the query keeps its errors to itself (`throwOnError: false`).
 */
export function QueryStatus({ query, what }: { query: UseQueryResult<unknown>; what: string }) {
  const box = useRef<HTMLDivElement>(null);
  const retried = useRef(false);
  const failed = query.isError;
  const hasData = query.data !== undefined;
  const stale = failed && hasData;
  const unloaded = failed && !hasData;

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

  const own = hasData && !query.isPlaceholderData;
  // Paused: the browser reports that it is offline, so the request waits and neither succeeds nor fails.
  const status = stale
    ? `Couldn't refresh ${what}. What you see may be out of date.`
    : failed
      ? ''
      : query.isPaused
        ? own
          ? 'You are offline. What you see may be out of date.'
          : `You are offline: ${what} will load when you are back online.`
        : own
          ? ''
          : `Loading ${what}…`;

  return (
    <div
      ref={box}
      tabIndex={-1}
      className={`rounded-sm ${failed ? 'flex flex-wrap items-center gap-3' : ''} ${stale ? 'rounded-md border border-warn px-3 py-2 text-sm' : ''}`}
    >
      {/* The live region is always on the page and only its text changes: a region that arrives together
          with its text is not announced by every screen reader. While the load error is shown it has
          nothing to say, and is taken out of the layout. */}
      <p role="status" className={unloaded ? 'hidden' : stale ? undefined : 'text-muted'}>
        {status}
      </p>
      {unloaded && <p role="alert">{`Couldn't load ${what}.`}</p>}
      {failed && (
        <Button variant={hasData ? 'secondary' : 'primary'} aria-busy={query.isFetching || undefined} onClick={retry}>
          {query.isFetching ? 'Trying again…' : 'Try again'}
        </Button>
      )}
    </div>
  );
}
