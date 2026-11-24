import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The page is driven through its API adapter; nothing here reaches a server.
const api = vi.hoisted(() => ({
  getClientProfile: vi.fn(),
  getPrizeProgression: vi.fn(),
  getGoogleWalletStatus: vi.fn(),
  getUserCoupons: vi.fn(),
  createGoogleWalletPass: vi.fn(),
}));
vi.mock('../lib/legacy-api-adapter', () => api);

// useAuth's user is the /me payload: stamps is an object, not a number.
const ME = vi.hoisted(() => ({
  id: 'user-123',
  email: 'mario@example.com',
  phone: null,
  isVerified: true,
  profile: { name: 'Mario', surname: 'Rossi' },
  stamps: { validStamps: 7 },
  coupons: { usedCoupons: 0, validCoupons: 0, coupons: [] },
  nextPrize: null,
}));
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ user: ME }) }));

// import.meta.env is inlined at build time; the handoff card reads it through buildEnv().
const { env } = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('../lib/build-env', () => ({ buildEnv: () => env }));

let consoleError: ReturnType<typeof vi.spyOn>;

async function renderPage() {
  const { default: CustomerPage } = await import('./customer');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomerPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  for (const fn of Object.values(api)) fn.mockReset();
  api.getPrizeProgression.mockResolvedValue({ stampsLastPrize: 0, stampsNextPrize: 15 });
  api.getGoogleWalletStatus.mockResolvedValue({ configured: false, linked: false, objectId: null });
  api.getUserCoupons.mockResolvedValue([]);
  // jsdom has no canvas: the QR component reports that through console.error.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('CustomerPage — profile query without data', () => {
  // Signup on iOS: the hard redirect cancels the in-flight profile fetch, which
  // rejects ("Load failed") and leaves the query errored, not loading.
  it('renders the stamps from the signed-in user', async () => {
    api.getClientProfile.mockRejectedValue(new TypeError('Load failed'));
    const page = await renderPage();

    await waitFor(() => expect(api.getClientProfile).toHaveBeenCalled());
    await waitFor(() => expect(page.getByText('7 / 15 Timbri')).toBeTruthy());
    expect(page.getByText('Ciao, Mario!')).toBeTruthy();
  });
});

describe('CustomerPage — optional handoff card', () => {
  async function renderWithHandoff() {
    const { default: CustomerPage } = await import('./customer');
    const { HandoffProvider } = await import('../features/handoff/HandoffProvider');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <HandoffProvider>
          <CustomerPage />
        </HandoffProvider>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    api.getClientProfile.mockResolvedValue(ME);
  });

  it('renders nothing when the brand has not configured it', async () => {
    const page = await renderPage();
    await waitFor(() => expect(page.getByText('7 / 15 Timbri')).toBeTruthy());
    expect(page.queryByText('Vai al sito promozioni')).toBeNull();
  });

  it('renders nothing with a malformed target', async () => {
    env.VITE_HANDOFF_LINK_TARGET = 'Promo Site';
    env.VITE_HANDOFF_LINK_LABEL = 'Vai al sito promozioni';
    const page = await renderWithHandoff();
    await waitFor(() => expect(page.getByText('7 / 15 Timbri')).toBeTruthy());
    expect(page.queryByText('Vai al sito promozioni')).toBeNull();
  });

  it('renders the configured card, and a tap starts the handoff to its target', async () => {
    env.VITE_HANDOFF_LINK_TARGET = 'promo-site';
    env.VITE_HANDOFF_LINK_LABEL = 'Vai al sito promozioni';
    env.VITE_HANDOFF_LINK_DESCRIPTION = 'Offerte riservate ai clienti';
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ error: 'UNKNOWN_HANDOFF_TARGET' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const page = await renderWithHandoff();
    const card = await page.findByText('Vai al sito promozioni');
    expect(page.getByText('Offerte riservate ai clienti')).toBeTruthy();

    card.click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(String(url)).toMatch(/\/api\/v1\/auth\/handoff$/);
    expect(JSON.parse(init.body)).toEqual({ target: 'promo-site' });
    vi.unstubAllGlobals();
  });
});
