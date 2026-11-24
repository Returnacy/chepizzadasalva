import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  registerUser: vi.fn(),
}));
vi.mock('../lib/legacy-api-adapter', () => api);

import { AuthProvider, useAuth } from './use-auth';
import { queryClient } from '../lib/queryClient';
import { clearPendingHandoff } from '../features/handoff/handoff';

const USER = { id: 'user-1', profile: { name: 'Mario' }, memberships: [] };

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}

// Returns the setTimeout calls made while logging in (timers are not run).
async function logIn() {
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(auth.isLoading).toBe(false));
  const timers = vi.spyOn(globalThis, 'setTimeout').mockImplementation((() => 0) as any);
  await act(async () => {
    await auth.loginMutation.mutateAsync({ authType: 'password', email: 'a@example.com', password: 'x' } as any);
  });
  const redirects = timers.mock.calls.filter((c: any[]) => c[1] === 500);
  timers.mockRestore();
  return redirects;
}


beforeEach(() => {
  clearPendingHandoff();
  sessionStorage.clear();
  queryClient.clear();
  api.getCurrentUser.mockResolvedValue(null);
  api.login.mockResolvedValue(USER);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuthProvider — redirect after login', () => {
  it('redirects to the role page when no handoff is pending', async () => {
    // The hard redirect after login is a setTimeout(…, 500) assigning location.href.
    expect(await logIn()).toHaveLength(1);
  });

  it('leaves the page to the handoff when one is pending', async () => {
    sessionStorage.setItem('pendingHandoff', JSON.stringify({ target: 'promo-site', at: Date.now() }));
    expect(await logIn()).toHaveLength(0);
    expect(auth.user).toMatchObject({ id: 'user-1' });
  });
});
