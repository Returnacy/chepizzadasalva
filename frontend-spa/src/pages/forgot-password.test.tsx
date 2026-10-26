import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { post, toast } = vi.hoisted(() => ({ post: vi.fn(), toast: vi.fn() }));
vi.mock('../lib/servicesHttp', () => ({ userHttp: { post } }));
vi.mock('../hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import ForgotPasswordPage from './forgot-password';

const NEUTRAL = /Se l'indirizzo è registrato riceverai un'email con le istruzioni/;
const REAL_ERROR = "Non siamo riusciti a inviare l'email, riprova tra poco";

function httpError(status: number, error: string) {
  return Object.assign(new Error(error), { status, body: { error } });
}

async function submit(email = 'mario@esempio.it') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ForgotPasswordPage />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText('email@esempio.com'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /invia link di reset/i }));
  await waitFor(() => expect(post).toHaveBeenCalled());
}

afterEach(() => {
  cleanup();
  post.mockReset();
  toast.mockReset();
});

describe('ForgotPasswordPage — no account enumeration', () => {
  it('a sent email shows the neutral message', async () => {
    post.mockResolvedValue({ ok: true });
    await submit();
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
  });

  it('an unknown email (404 USER_NOT_FOUND) shows the very same message', async () => {
    post.mockRejectedValue(httpError(404, 'USER_NOT_FOUND'));
    await submit();
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    expect(toast).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'FORGOT_PASSWORD_FAILED'],
    [500, 'MESSAGING_SERVICE_URL_NOT_CONFIGURED'],
  ])('a real failure (%i) says so and stays on the form', async (status, code) => {
    post.mockRejectedValue(httpError(status, code));
    await submit();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: REAL_ERROR, variant: 'destructive' })));
    expect(screen.queryByText(NEUTRAL)).toBeNull();
    expect(screen.getByRole('button', { name: /invia link di reset/i })).toBeTruthy();
  });
});
