import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The page is driven through its API adapter; nothing here reaches a server.
const api = vi.hoisted(() => ({
  getUser: vi.fn(),
  addStamps: vi.fn(),
  getPrizeProgression: vi.fn(),
  getUserCoupons: vi.fn(),
  getCouponByCode: vi.fn(),
  redeemCoupon: vi.fn(),
}));
vi.mock('../lib/legacy-api-adapter', () => api);

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../features/scan/components/StaffLocationGate', () => ({ StaffLocationGate: () => null }));

// Stand-in camera: one button that "reads" a QR. The real one needs getUserMedia.
const QR_TEXT = vi.hoisted(() => ({ value: '' }));
vi.mock('../features/scan/components/CameraScannerCard', () => ({
  CameraScannerCard: ({ onScan }: { onScan: (code: string) => void }) => (
    <button onClick={() => onScan(QR_TEXT.value)}>leggi QR</button>
  ),
}));

const CUSTOMER = {
  id: 'user-123',
  email: 'mario@example.com',
  profile: { name: 'Mario', surname: 'Rossi' },
  stamps: { validStamps: 4, usedStamps: 0, totalStamps: 4 },
};

// jsdom cannot navigate: a full-page load (href assignment or reload) is
// reported as "Not implemented: navigation" through console.error.
let consoleError: ReturnType<typeof vi.spyOn>;
function navigationAttempts() {
  return consoleError.mock.calls.filter((args) => String(args[0]?.message ?? args[0]).includes('navigation'));
}

async function renderPage() {
  const { default: ScanQRPage } = await import('./scan-qr');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScanQRPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/scan-qr');
  for (const fn of Object.values(api)) fn.mockReset();
  api.getUser.mockResolvedValue(CUSTOMER);
  api.getUserCoupons.mockResolvedValue([]);
  api.getPrizeProgression.mockResolvedValue({ stampsLastPrize: 0, stampsNextPrize: 15 });
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('ScanQRPage — camera scan stays on the page', () => {
  it('the navigation detector does see a full-page load', () => {
    window.location.href = '/scan-qr?customer=x';
    expect(navigationAttempts().length).toBeGreaterThan(0);
  });

  it('shows the customer from the scan without reloading', async () => {
    QR_TEXT.value = 'user-123';
    const page = await renderPage();

    fireEvent.click(page.getByText('leggi QR'));

    await waitFor(() => expect(page.getByText('Cliente Trovato')).toBeTruthy());
    expect(page.getByText('Mario Rossi')).toBeTruthy();
    expect(api.getUser).toHaveBeenCalledTimes(1);
    expect(api.getUser).toHaveBeenCalledWith('user-123');
    expect(navigationAttempts()).toEqual([]);
    expect(window.location.search).toBe('');
  });

  it('follows a full scan-qr URL in the QR in-page too', async () => {
    QR_TEXT.value = 'https://fidelity.chepizzadasalva.it/scan-qr?customer=user-123';
    const page = await renderPage();

    fireEvent.click(page.getByText('leggi QR'));

    await waitFor(() => expect(page.getByText('Cliente Trovato')).toBeTruthy());
    expect(api.getUser).toHaveBeenCalledWith('user-123');
    expect(navigationAttempts()).toEqual([]);
  });

  it('applies stamps from the response alone: no reload, no user refetch', async () => {
    QR_TEXT.value = 'user-123';
    api.addStamps.mockResolvedValue({
      validStamps: 5,
      createdCoupon: null,
      nextPrize: { name: 'Pizza', stampsLastPrize: 0, stampsNextPrize: 15 },
    });
    const page = await renderPage();
    fireEvent.click(page.getByText('leggi QR'));
    await waitFor(() => expect(page.getByText('Cliente Trovato')).toBeTruthy());

    fireEvent.click(page.getByText('Aggiungi 1 Timbro'));

    await waitFor(() => expect(page.getByText('5')).toBeTruthy());
    expect(api.addStamps).toHaveBeenCalledWith('user-123', 1, 'qr_camera');
    expect(api.getUser).toHaveBeenCalledTimes(1);
    expect(navigationAttempts()).toEqual([]);
  });

  it('never offers to remove stamps', async () => {
    QR_TEXT.value = 'user-123';
    const page = await renderPage();
    fireEvent.click(page.getByText('leggi QR'));
    await waitFor(() => expect(page.getByText('Cliente Trovato')).toBeTruthy());

    // The minus button is disabled at 1, so the counter cannot go below it.
    expect(page.queryByText(/Rimuovi/)).toBeNull();
    expect(page.getByText('Aggiungi 1 Timbro')).toBeTruthy();
  });
});
