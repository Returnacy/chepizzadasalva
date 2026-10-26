import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// The build's tenant: Sud Est. Mocked so the test does not depend on the env
// (getBusinessId() would otherwise fall back to Che Pizza's Taggi id).
vi.mock('./authz', async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    getTenantContext: () => ({ businessId: 'eb48c067-e914-4532-bd55-bd08766ac0a0', brandId: 'd99f0f54-3367-4a7e-a3ab-67564c805e46' }),
  };
});

const { auth } = vi.hoisted(() => ({ auth: { user: null as any } }));
vi.mock('../hooks/use-auth', () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: false,
    error: null,
    loginMutation: { isPending: false, mutateAsync: vi.fn() },
    registerMutation: { isPending: false, mutateAsync: vi.fn() },
    logoutMutation: { isPending: false, mutate: vi.fn() },
  }),
}));

import { ProtectedRoute } from './protected-route';

const Secret = () => <div>contenuto protetto</div>;

afterEach(() => {
  cleanup();
  auth.user = null;
});

describe('ProtectedRoute — account without a membership in this brand', () => {
  it('shows the "not enrolled" screen, not the page, to another brand’s staff', () => {
    auth.user = {
      id: 'u1',
      memberships: [{ brandId: '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47', businessId: 'af941888-ec4c-458e-b905-21673241af3e', role: 'STAFF' }],
    };
    render(<ProtectedRoute path="/" component={Secret} allowedRoles={['staff']} />);
    expect(screen.queryByText('contenuto protetto')).toBeNull();
    expect(screen.getByText(/non è iscritto a/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Esci' })).toBeTruthy();
    // No way to register from here: the backend refuses an existing email.
    expect(screen.queryByText(/registrati/i)).toBeNull();
  });

  it('shows the same screen on the customer route (no allowedRoles)', () => {
    auth.user = { id: 'u1', memberships: [] };
    render(<ProtectedRoute path="/" component={Secret} />);
    expect(screen.queryByText('contenuto protetto')).toBeNull();
    expect(screen.getByText(/non è iscritto a/i)).toBeTruthy();
  });

  it('lets a member of this brand through', () => {
    auth.user = { id: 'u1', memberships: [{ brandId: 'd99f0f54-3367-4a7e-a3ab-67564c805e46', businessId: 'eb48c067-e914-4532-bd55-bd08766ac0a0', role: 'USER' }] };
    render(<ProtectedRoute path="/" component={Secret} />);
    expect(screen.getByText('contenuto protetto')).toBeTruthy();
  });
});
