import { useQuery } from '@tanstack/react-query';

/** An HTTP `Date` header has whole seconds, so the server's clock read somewhere within that second. */
const HEADER_MIDPOINT_MS = 500;

/**
 * How far the server's clock is ahead of this device's, in milliseconds (negative when it is behind).
 *
 * The assessments API gives a deadline but not the current time, so the server's time is read from the
 * `Date` header of a small uncached request, and compared with the middle of the time that request took.
 * That is right to about half a second plus half the round trip. When the header cannot be read the answer
 * is 0: the device's own clock is then the only one there is.
 */
export async function serverClockOffset(): Promise<number> {
  try {
    const sent = Date.now();
    const res = await fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    const received = Date.now();
    const serverTime = Date.parse(res.headers.get('Date') ?? '');
    if (Number.isNaN(serverTime)) return 0;
    return serverTime + HEADER_MIDPOINT_MS - (sent + received) / 2;
  } catch {
    return 0;
  }
}

/** The offset, measured once each time a screen that needs it opens; `undefined` until it is known. */
export function useServerClockOffset(): number | undefined {
  return useQuery({ queryKey: ['server-clock'], queryFn: serverClockOffset, staleTime: Infinity, gcTime: 0 }).data;
}
