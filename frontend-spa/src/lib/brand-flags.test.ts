import { describe, it, expect, beforeEach, vi } from 'vitest';

// import.meta.env is inlined at build time, so a test drives these switches by
// standing in for the env bag itself.
const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('./build-env', () => ({ buildEnv: () => env }));

import { isChePizzaBuild, getGoogleClientId, isGoogleLoginEnabled } from './brand-flags';

const CHE_PIZZA_CLIENT_ID = '686092411702-example.apps.googleusercontent.com';

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

describe('isChePizzaBuild', () => {
  it('is true when no brand name is set (this repo IS Che Pizza)', () => {
    env.VITE_BRAND_NAME = '';
    expect(isChePizzaBuild()).toBe(true);
  });

  it('is true when the brand name is Che Pizza', () => {
    env.VITE_BRAND_NAME = 'Che Pizza';
    expect(isChePizzaBuild()).toBe(true);
  });

  it('is false for another brand', () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    expect(isChePizzaBuild()).toBe(false);
  });
});

describe('isGoogleLoginEnabled', () => {
  it('is on for Che Pizza with no extra variable — the live build must not change', () => {
    env.VITE_BRAND_NAME = '';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;
    expect(isGoogleLoginEnabled()).toBe(true);
  });

  it('is off for a new brand that never asked for it', () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;
    expect(isGoogleLoginEnabled()).toBe(false);
  });

  it('is on for a new brand that opts in explicitly', () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;
    env.VITE_GOOGLE_LOGIN_ENABLED = 'true';
    expect(isGoogleLoginEnabled()).toBe(true);
  });

  it('treats anything other than "true" as off', () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      env.VITE_GOOGLE_LOGIN_ENABLED = value;
      expect(isGoogleLoginEnabled()).toBe(false);
    }
  });

  it('is off without a client id, opt-in or not', () => {
    env.VITE_GOOGLE_CLIENT_ID = '';
    env.GOOGLE_CLIENT_ID = '';
    env.VITE_BRAND_NAME = '';
    expect(isGoogleLoginEnabled()).toBe(false);

    env.VITE_GOOGLE_LOGIN_ENABLED = 'true';
    expect(isGoogleLoginEnabled()).toBe(false);
  });
});

describe('getGoogleClientId', () => {
  it('trims and prefers the VITE_-prefixed variable', () => {
    env.VITE_GOOGLE_CLIENT_ID = `  ${CHE_PIZZA_CLIENT_ID}  `;
    expect(getGoogleClientId()).toBe(CHE_PIZZA_CLIENT_ID);
  });

  it('is empty when unset', () => {
    env.VITE_GOOGLE_CLIENT_ID = '';
    env.GOOGLE_CLIENT_ID = '';
    expect(getGoogleClientId()).toBe('');
  });
});
