import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { LinkInfo } from '../../api/types';

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD_BYTES = 72;

export const INVALID_LINK = 'This link is no longer valid. Ask for a new one.';
export const LINK_CHECK_FAILED = "Couldn't check this link. Try again.";

/**
 * Checks an invite/reset token before showing the form. Exactly one of these holds: `pending`, `invalid`
 * (unknown, used, expired or wrong kind of link), `failed` (the check itself went wrong, e.g. a 500; `retry`
 * runs it again), or the link is good. Network/503 failures go to the error boundary instead.
 */
export function useLinkCheck(token: string | undefined, purpose: LinkInfo['purpose']) {
  const q = useQuery({
    queryKey: ['link', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => api.get<LinkInfo>(`auth/invite/${encodeURIComponent(token!)}`),
  });
  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410);
  const wrongKind = q.data !== undefined && q.data.purpose !== purpose;
  const pending = Boolean(token) && (q.isPending || (q.isFetching && q.data === undefined));
  const invalid = !token || gone || wrongKind;
  return {
    pending,
    invalid,
    failed: !pending && !invalid && q.isError,
    retry: () => void q.refetch(),
    info: q.data,
  };
}

export function passwordProblem(pw: string): string | undefined {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  return undefined;
}
