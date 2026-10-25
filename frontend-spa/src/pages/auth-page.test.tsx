import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// import.meta.env is inlined at build time; standing in for the env bag is how
// one test run can play several brands' builds.
const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('../lib/build-env', () => ({ buildEnv: () => env }));

// The page only needs the auth surface to exist; nothing here logs anybody in.
vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    error: null,
    loginMutation: { isPending: false, mutateAsync: vi.fn() },
    registerMutation: { isPending: false, mutateAsync: vi.fn() },
    logoutMutation: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

const CHE_PIZZA_CLIENT_ID = '686092411702-example.apps.googleusercontent.com';

async function renderAuthPage() {
  const { default: AuthPage } = await import('./auth-page');
  return render(<AuthPage />);
}

function googleSlots(container: HTMLElement) {
  return {
    login: container.querySelector('#google-login-btn'),
    signup: container.querySelector('#google-signup-btn'),
  };
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  // The GIS <script> is appended to document.head, which outlives a render.
  document.getElementById('google-identity-services')?.remove();
  delete (window as any).google;
});

afterEach(() => {
  cleanup();
});

describe('AuthPage — Google sign-in slot', () => {
  it("keeps the button on Che Pizza's build (no VITE_BRAND_* set)", async () => {
    env.VITE_BRAND_NAME = '';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;

    const { container } = await renderAuthPage();
    expect(googleSlots(container).login).not.toBeNull();
  });

  it('leaves nothing behind on a brand that has not authorised its origin', async () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;

    const { container } = await renderAuthPage();
    const slots = googleSlots(container);
    expect(slots.login).toBeNull();
    expect(slots.signup).toBeNull();
    // No divider or placeholder text either: the page must read as email + password only.
    expect(container.textContent).not.toMatch(/google/i);
    expect(container.textContent).not.toMatch(/oppure/i);
  });

  it('brings the button back once VITE_GOOGLE_LOGIN_ENABLED=true', async () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;
    env.VITE_GOOGLE_LOGIN_ENABLED = 'true';

    const { container } = await renderAuthPage();
    expect(googleSlots(container).login).not.toBeNull();
  });

  it('stays hidden when no client id was built in at all', async () => {
    env.VITE_BRAND_NAME = '';
    env.VITE_GOOGLE_CLIENT_ID = '';
    env.GOOGLE_CLIENT_ID = '';

    const { container } = await renderAuthPage();
    expect(googleSlots(container).login).toBeNull();
  });

  it('never loads Google Identity Services when the button is hidden', async () => {
    env.VITE_BRAND_NAME = 'Pizzeria Sud Est';
    env.VITE_GOOGLE_CLIENT_ID = CHE_PIZZA_CLIENT_ID;

    await renderAuthPage();
    expect(document.getElementById('google-identity-services')).toBeNull();
  });
});

describe('AuthPage — loyalty copy', () => {
  // The page carries no prize copy at all: each brand's rewards come from its
  // own Prize rows, so the auth page must not promise Che Pizza's free pizza.
  it.each(['', 'Pizzeria Sud Est'])("never promises a free pizza (VITE_BRAND_NAME=%j)", async (name) => {
    env.VITE_BRAND_NAME = name;

    const { container } = await renderAuthPage();
    expect(container.textContent).not.toMatch(/pizza gratuita/i);
  });
});
