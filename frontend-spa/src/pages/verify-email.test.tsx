import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../lib/http', () => ({ http: { post } }));

import VerifyEmailPage from './verify-email';

function httpError(status: number, error: string) {
  return Object.assign(new Error(error), { status, body: { error } });
}

// The link in the email lands on /auth/verify-email?token=…; wouter reads the
// query string from the real location.
function openLink(search: string) {
  window.history.pushState({}, '', `/auth/verify-email${search}`);
  render(<VerifyEmailPage />);
}

afterEach(() => {
  cleanup();
  post.mockReset();
  window.history.pushState({}, '', '/');
});

describe('VerifyEmailPage', () => {
  it('confirms the token on the user-service endpoint and shows success', async () => {
    post.mockResolvedValue({ ok: true });
    openLink('?token=abc');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/auth/verify-email/confirm', { token: 'abc' }));
    expect(await screen.findByText('Email verificata')).toBeTruthy();
  });

  it('an invalid or expired token (400) shows the Italian message', async () => {
    post.mockRejectedValue(httpError(400, 'INVALID_OR_EXPIRED_TOKEN'));
    openLink('?token=bogus');
    expect(await screen.findByText(/Link non valido o scaduto/)).toBeTruthy();
    expect(screen.getByText('Verifica fallita')).toBeTruthy();
  });

  it('any other failure shows the generic Italian message', async () => {
    post.mockRejectedValue(httpError(404, 'USER_NOT_FOUND'));
    openLink('?token=abc');
    expect(await screen.findByText('Verifica non riuscita. Riprova più tardi.')).toBeTruthy();
  });

  it('without a token shows an error and never calls the network', async () => {
    openLink('');
    expect(await screen.findByText(/manca il codice/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });
});
