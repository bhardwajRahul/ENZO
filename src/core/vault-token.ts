/**
 * vault-token.ts — the vault session token formula.
 *
 * A minted token is HMAC(masterKey, message) over a 12-hour window: no
 * server-side session state, nothing to revoke short of rotating the keys.
 * The formula lives in its own module because BOTH index.ts (the routes) and
 * projects/project.ts (the ownership check) need it — a duplicated formula
 * drifts, and project.ts can't import index.ts back (circular).
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const VAULT_TOKEN_WINDOW_MS = 12 * 60 * 60 * 1000;

export function vaultTokenForWindow(window: number): string | null {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const masterKey = (process.env.ENZO_MASTER_KEY || '').trim();
  if (!masterKey) return null;
  // Groq key present → the original groq-bound formula (rotating GROQ_API_KEY
  // revokes every vault session). Absent → instance formula, so a fresh
  // install that claimed e.g. an OpenRouter key still mints. See vault-boot.ts.
  const message = groqKey ? `enzo-vault:${groqKey}:${window}` : `enzo-vault:instance:${window}`;
  return createHmac('sha256', masterKey).update(message).digest('hex');
}

/** Mint a token for the current window (what /api/vault/session hands out). */
export function vaultSessionToken(): string | null {
  return vaultTokenForWindow(Math.floor(Date.now() / VAULT_TOKEN_WINDOW_MS));
}

/** Accept the current window or the one before it. Constant-time either way. */
export function vaultTokenIsValid(provided: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const now = Math.floor(Date.now() / VAULT_TOKEN_WINDOW_MS);
  // Both branches always run — no early return on the current-window match, so
  // the number of comparisons does not leak which window matched.
  const current = vaultTokenForWindow(now);
  const previous = vaultTokenForWindow(now - 1);
  const okCurrent = current ? safeKeyEqual(provided, current) : false;
  const okPrevious = previous ? safeKeyEqual(provided, previous) : false;
  return okCurrent || okPrevious;
}

function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length === 0 || bb.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
