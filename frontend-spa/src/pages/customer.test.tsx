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
