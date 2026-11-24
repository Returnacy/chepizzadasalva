/**
 * Customer handoff: single sign-on from this SPA to another service of the same
 * brand. user-service mints a 60-second token for a *target* key and answers
 * with the URL that target lives at; the SPA delivers the token there with a
 * top-level form POST. The client names a target, never a destination — the
 * URL is server-configured, so a crafted ?handoff= can only reach services the
 * brand has registered.
 *
 * Two entry points:
 *  - `?handoff=<target>` on any SPA URL (the other service links to /auth with
 *    it). It is captured before the first render and kept in sessionStorage,
 *    because the way to "logged in" can pass through full-page redirects that
 *    drop the query string (ProtectedRoute → /auth, the refresh failure in
 *    token-service, the hard redirect after login/registration).
 *  - an optional card on the customer page, configured per brand at build time
 *    (getHandoffLink).
 *
 * The token itself is never stored, logged, tracked or put in a URL.
 */
import { buildEnv } from '../../lib/build-env';
import { userHttp } from '../../lib/servicesHttp';
import { tokenService } from '../../lib/token-service';
import { track } from '../../lib/posthog';

export const HANDOFF_PARAM = 'handoff';
const TARGET_PATTERN = /^[a-z0-9-]{1,40}$/;
const STORAGE_KEY = 'pendingHandoff';
const PENDING_TTL_MS = 30 * 60 * 1000;

export type HandoffSource = 'link' | 'card';

/** Why a handoff did not happen. The first three are user-service's own codes. */
export type HandoffFailure =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'UNKNOWN_HANDOFF_TARGET'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE';

export type HandoffResult = { ok: true } | { ok: false; reason: HandoffFailure };

export function isValidHandoffTarget(value: unknown): value is string {
  return typeof value === 'string' && TARGET_PATTERN.test(value);
}

// --- pending target -----------------------------------------------------------

type Pending = { target: string; at: number };

// Mirror of the stored value, and the only copy when sessionStorage is
// unavailable (some private modes): the handoff then survives in-app
// navigation but not a full-page redirect.
let memoryPending: Pending | null = null;

function writePending(pending: Pending | null): void {
  memoryPending = pending;
  try {
    if (pending) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidHandoffTarget(parsed?.target) && typeof parsed?.at === 'number') return parsed;
    }
  } catch {}
  return memoryPending;
}

/**
 * Reads ?handoff=<target> from the current URL, remembers it, and takes it out
 * of the address bar. Anything that is not a valid target key is left alone.
 * Called once, before the first render (main.tsx).
 */
export function captureHandoffFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const target = params.get(HANDOFF_PARAM);
  if (!isValidHandoffTarget(target)) return;
  writePending({ target, at: Date.now() });
  params.delete(HANDOFF_PARAM);
  const query = params.toString();
  try {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    );
  } catch {}
}

/** The target waiting for a logged-in session, if any and not older than 30 minutes. */
export function getPendingHandoff(now: number = Date.now()): string | null {
  const pending = readPending();
  if (!pending) return null;
  if (now - pending.at > PENDING_TTL_MS || now < pending.at) {
    writePending(null);
    return null;
  }
  return pending.target;
}

export function hasPendingHandoff(): boolean {
  return getPendingHandoff() !== null;
}

export function clearPendingHandoff(): void {
  writePending(null);
}

// --- per-brand card ------------------------------------------------------------

export type HandoffLink = { target: string; label: string; description: string };

function envValue(name: string): string {
  const raw = buildEnv()[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The optional "go to the brand's other service" card on the customer page.
 * Null unless the build sets both VITE_HANDOFF_LINK_TARGET (a valid key) and
 * VITE_HANDOFF_LINK_LABEL; scripts/check-brand.mjs refuses a half-set pair.
 */
export function getHandoffLink(): HandoffLink | null {
  const target = envValue('VITE_HANDOFF_LINK_TARGET');
  const label = envValue('VITE_HANDOFF_LINK_LABEL');
  if (!isValidHandoffTarget(target) || !label) return null;
  return { target, label, description: envValue('VITE_HANDOFF_LINK_DESCRIPTION') };
}

// --- the handoff itself ----------------------------------------------------------

type HandoffResponse = { token?: unknown; expiresIn?: unknown; url?: unknown };

function requestToken(target: string): Promise<HandoffResponse> {
  return userHttp.post<HandoffResponse>('/api/v1/auth/handoff', { target });
}

async function requestTokenWithRefresh(target: string): Promise<HandoffResponse> {
  try {
    return await requestToken(target);
  } catch (e: any) {
    if (e?.status !== 401) throw e;
    // /auth/* routes are exempt from the shared refresh-and-retry
    // (retry-middleware), but this one is called with a session that may have
    // expired while the customer page sat open. One refresh, one retry; a
    // failed refresh logs out and sends to /auth by itself (token-service).
    await tokenService.refresh();
    return await requestToken(target);
  }
}

function classify(e: any): HandoffFailure {
  const status = e?.status;
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  // Also what a user-service without the route answers: same outcome.
  if (status === 404) return 'UNKNOWN_HANDOFF_TARGET';
  if (e?.code === 'INVALID_RESPONSE') return 'INVALID_RESPONSE';
  if (typeof status !== 'number') return 'NETWORK';
  return 'SERVER_ERROR';
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Hands the token over with a top-level POST: the token travels in the request
 * body, never in a URL (history, logs, Referer). The form leaves the DOM as
 * soon as it is submitted; the browser has already taken its data.
 */
export function submitHandoffForm(url: string, token: string): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'token';
  input.value = token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

let inFlight = false;

/** Back from the other service via bfcache: the page is alive again, so is the button. */
export function resetHandoffInFlight(): void {
  inFlight = false;
}

/**
 * Mints a token for `target` and posts it to the URL user-service returns.
 * Resolves null when another handoff is already running (double tap, a second
 * effect run). The pending target is cleared on every outcome, so a link is
 * attempted once.
 */
export async function runHandoff(target: string, source: HandoffSource): Promise<HandoffResult | null> {
  if (inFlight) return null;
  inFlight = true;
  track('handoff_started', { target, source });
  try {
    const res = await requestTokenWithRefresh(target);
    if (typeof res?.token !== 'string' || res.token === '' || !isWebUrl(res.url)) {
      throw Object.assign(new Error('Invalid handoff response'), { code: 'INVALID_RESPONSE' });
    }
    clearPendingHandoff();
    track('handoff_submitted', { target, source });
    submitHandoffForm(res.url, res.token);
    // inFlight stays set: the page is navigating away.
    return { ok: true };
  } catch (e) {
    clearPendingHandoff();
    inFlight = false;
    const reason = classify(e);
    track('handoff_failed', { target, source, reason });
    return { ok: false, reason };
  }
}
