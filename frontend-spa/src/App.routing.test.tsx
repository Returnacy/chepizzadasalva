import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Only the router is under test: the shell around it is stubbed out.
vi.mock('./hooks/use-auth', () => ({
  AuthProvider: ({ children }: any) => children,
  useAuth: () => ({
    user: null,
    isLoading: false,
    error: null,
    loginMutation: { isPending: false, mutateAsync: vi.fn() },
    registerMutation: { isPending: false, mutateAsync: vi.fn() },
    logoutMutation: { isPending: false, mutate: vi.fn() },
  }),
}));
vi.mock('./components/navigation', () => ({ Navigation: () => null }));
vi.mock('./components/TermsConsentDialog', () => ({ default: () => null }));
vi.mock('./pages/verify-email', () => ({ default: () => <div>pagina verifica email</div> }));

import App from './App';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('App routing — email verification link', () => {
  it.each(['/auth/verify-email', '/verify-email', '/email-verifications'])('%s opens the verification page, not NotFound', (path) => {
    window.history.pushState({}, '', `${path}?token=abc`);
    render(<App />);
    expect(screen.getByText('pagina verifica email')).toBeTruthy();
    expect(screen.queryByText('404 Page Not Found')).toBeNull();
  });
});
