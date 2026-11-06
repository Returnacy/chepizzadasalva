/**
 * Product analytics (PostHog) for this SPA. The contract — event names,
 * properties, what never goes in them — is PizzeriaOS/PIZZERIA_OS_ANALYTICS.md;
 * add an event there before adding it here. Not to be confused with
 * src/api/analytics.ts, which is the owner's business analytics.
 *
 * Off unless the brand's Pages project sets VITE_POSTHOG_KEY: every export is
 * then a no-op, so tests and brands without a key send nothing.
 *
 * Customers use this app, so: memory persistence (no cookie, no storage), a
 * pseudonymous id, and never a name, email or phone in any property.
 */
import posthog, { type CaptureResult } from 'posthog-js';
import { buildEnv } from './build-env';

export type AnalyticsEvent =
  | 'signup_completed'
  | 'stamp_added'
  | 'coupon_redeemed'
  | 'crm_customer_opened'
  | 'pm_chiusura_opened';

/** How a stamp or coupon reached the counter: CRM page, or /scan-qr by camera or by hand. */
export type ScanPath = 'crm' | 'qr_camera' | 'qr_manual';

export type AnalyticsRole = 'owner' | 'staff' | 'customer';

let enabled = false;

function envValue(name: string): string {
  const raw = buildEnv()[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

// Query strings and fragments carry secrets here — /auth gets #accessToken=…,
// the password-reset link ?token=… — so no URL leaves with them.
function stripUrls(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once]) {
    if (!bag) continue;
    for (const key of Object.keys(bag)) {
      const value = bag[key];
      if (/(url|referrer)$/i.test(key) && typeof value === 'string') bag[key] = value.split(/[?#]/)[0];
    }
  }
  return event;
}

export function initAnalytics(): void {
  const key = envValue('VITE_POSTHOG_KEY');
  if (!key || enabled) return;
  posthog.init(key, {
    api_host: envValue('VITE_POSTHOG_HOST') || 'https://eu.i.posthog.com',
    persistence: 'memory',
    autocapture: false,
    capture_pageview: 'history_change',
    capture_pageleave: false,
    disable_session_recording: true,
    advanced_disable_feature_flags: true,
    capture_exceptions: true,
    before_send: stripUrls,
  });
  const client = envValue('VITE_ANALYTICS_CLIENT');
  posthog.register(client ? { app: 'returnacy', client } : { app: 'returnacy' });
  enabled = true;
}

/** Maps this app's tenant roles onto the suite-wide owner | staff | customer. */
export function analyticsRole(role: string | null | undefined): AnalyticsRole {
  const r = (role ?? '').toLowerCase();
  if (r === 'admin' || r === 'brand_manager' || r === 'manager') return 'owner';
  if (r === 'staff') return 'staff';
  return 'customer';
}

export function identifyUser(userId: string, role: AnalyticsRole): void {
  if (!enabled) return;
  posthog.identify(`returnacy:${userId}`, { role });
}

export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}

// Sent at once, not batched: most of these are followed by a reload or a
// redirect (stamps reload /scan-qr, chiusura leaves for PM), and a queued event
// would depend on the unload flush, which drops events.
export function track(event: AnalyticsEvent, props?: Record<string, string>): void {
  if (!enabled) return;
  posthog.capture(event, props, { send_instantly: true });
}
