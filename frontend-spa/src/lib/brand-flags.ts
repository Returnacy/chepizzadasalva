/**
 * Build-time feature switches that depend on which brand this bundle is for.
 *
 * One Cloudflare Pages project per brand, same code, different env — so a
 * feature that is wired up for Che Pizza's Google project is not automatically
 * wired up for anybody else's. Google sign-in is the case this file exists for:
 * VITE_GOOGLE_CLIENT_ID lives in the committed .env.local and therefore reaches
 * every brand's build, but it is *Che Pizza's* OAuth client. On any other
 * origin Google refuses the request, so the button could only ever hand the
 * client's customers an error. It has to be off until somebody has authorised
 * that origin in the Google console — and then turned on deliberately, with
 * VITE_GOOGLE_LOGIN_ENABLED=true.
 *
 * Keep the rule here and nowhere else: two copies of it would drift, and the
 * drifting copy is the one that ships a broken button.
 */

import { buildEnv } from './build-env';

// Duplicated from scripts/check-brand.mjs on purpose — that script is plain
// node run before the bundler exists, so it cannot import this module. Both
// have to agree on what "this is Che Pizza's own build" means.
const CHE_PIZZA_BRAND_NAME = 'Che Pizza';

function envValue(name: string): string {
  const raw = buildEnv()[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * True for Che Pizza's own deployment: the one build that sets no VITE_BRAND_*
 * overrides, because src/config/brand.ts already defaults to its values.
 */
export function isChePizzaBuild(): boolean {
  const brandName = envValue('VITE_BRAND_NAME');
  return brandName === '' || brandName === CHE_PIZZA_BRAND_NAME;
}

/** The Google OAuth client this bundle was built with, if any. */
export function getGoogleClientId(): string {
  return envValue('VITE_GOOGLE_CLIENT_ID') || envValue('GOOGLE_CLIENT_ID');
}

/**
 * Whether to offer "Accedi con Google" at all — the gate on the button, on
 * loading Google Identity Services, and on One Tap.
 *
 * Fail closed: a client id alone is not enough, because the committed one is
 * Che Pizza's and works only on Che Pizza's origins.
 */
export function isGoogleLoginEnabled(): boolean {
  if (!getGoogleClientId()) return false;
  if (envValue('VITE_GOOGLE_LOGIN_ENABLED') === 'true') return true;
  return isChePizzaBuild();
}
