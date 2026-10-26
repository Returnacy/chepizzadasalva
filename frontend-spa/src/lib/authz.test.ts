import { describe, it, expect } from 'vitest';
import { getRolesForContext, getHighestRole, hasAnyRole, isTenantMember, type TenantContext } from './authz';

// Two Returnacy tenants sharing one user-service.
const CHE_PIZZA = { brandId: '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47', businessId: 'af941888-ec4c-458e-b905-21673241af3e' };
const SUD_EST = { brandId: 'd99f0f54-3367-4a7e-a3ab-67564c805e46', businessId: 'eb48c067-e914-4532-bd55-bd08766ac0a0' };
const LISSARO = 'f103ce67-ad79-4bf6-99ca-1d632caf7786';

function userWith(memberships: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { id: 'u1', email: 'a@b.it', memberships, ...extra } as any;
}

const chePizzaStaff = userWith([{ ...CHE_PIZZA, role: 'STAFF' }], { role: 'staff' });

describe('getRolesForContext — roles never cross tenants', () => {
  it('a STAFF membership on brand A gives no role on brand B', () => {
    expect(getRolesForContext(chePizzaStaff, SUD_EST)).toEqual([]);
    expect(getHighestRole(chePizzaStaff, SUD_EST)).toBeNull();
    expect(hasAnyRole(chePizzaStaff, ['staff'], SUD_EST)).toBe(false);
    expect(isTenantMember(chePizzaStaff, SUD_EST)).toBe(false);
  });

  it('the same membership still counts on its own brand', () => {
    expect(getRolesForContext(chePizzaStaff, CHE_PIZZA)).toEqual(['staff']);
    expect(getHighestRole(chePizzaStaff, CHE_PIZZA)).toBe('staff');
  });

  it('only the current tenant’s roles are returned when the account has both', () => {
    const both = userWith([
      { ...CHE_PIZZA, role: 'ADMIN' },
      { ...SUD_EST, role: 'USER' },
    ]);
    expect(getRolesForContext(both, SUD_EST)).toEqual(['user']);
    expect(getHighestRole(both, SUD_EST)).toBe('user');
  });

  it('no membership in the tenant → no roles, whatever the top-level role says', () => {
    const u = userWith([], { role: 'admin' });
    expect(getRolesForContext(u, SUD_EST)).toEqual([]);
    expect(getHighestRole(u, SUD_EST)).toBeNull();
  });

  it('an empty context matches nothing (it used to mean "every membership")', () => {
    const empty: TenantContext = { businessId: null, brandId: null };
    expect(getRolesForContext(chePizzaStaff, empty)).toEqual([]);
    expect(getHighestRole(chePizzaStaff, empty)).toBeNull();
    expect(isTenantMember(chePizzaStaff, empty)).toBe(false);
  });

  it('a brand-level membership matches on brandId when the build knows its brand', () => {
    const brandManager = userWith([{ brandId: SUD_EST.brandId, businessId: null, role: 'BRAND_MANAGER' }]);
    expect(getHighestRole(brandManager, SUD_EST)).toBe('brand_manager');
  });

  it('a legacy row with only a businessId matches that business', () => {
    const legacy = userWith([{ brandId: null, businessId: LISSARO, role: 'MANAGER' }]);
    expect(getRolesForContext(legacy, { businessId: LISSARO, brandId: CHE_PIZZA.brandId })).toEqual(['manager']);
    expect(getRolesForContext(legacy, CHE_PIZZA)).toEqual([]);
  });

  it('no user or no memberships array → no roles', () => {
    expect(getRolesForContext(null, SUD_EST)).toEqual([]);
    expect(getRolesForContext({ id: 'x' } as any, SUD_EST)).toEqual([]);
  });
});
