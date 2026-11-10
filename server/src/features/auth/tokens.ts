import { createHash, randomBytes } from 'node:crypto';

export function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

/** A fresh 32-byte random token (base64url) and the SHA-256 hex digest that is stored instead of it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
