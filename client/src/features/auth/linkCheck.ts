import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { LinkInfo } from '../../api/types';

export const INVALID_LINK = 'This link is no longer valid. Ask for a new one.';
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD_BYTES = 72;

/** Checks an invite/reset token before showing the form. `invalid` is true for unknown, used or expired links. */
export function useLinkCheck(token: string | undefined, purpose: LinkInfo['purpose']) {
  const q = useQuery({
    queryKey: ['link', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: () => api.get<LinkInfo>(`auth/invite/${encodeURIComponent(token!)}`),
  });
  const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 410);
  const wrongKind = q.data !== undefined && q.data.purpose !== purpose;
  return {
    pending: q.isPending && Boolean(token),
    invalid: !token || gone || wrongKind,
    info: q.data,
    otherError: !gone && q.error instanceof ApiError ? q.error : undefined,
  };
}

export function passwordProblem(pw: string): string | undefined {
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  return undefined;
}
