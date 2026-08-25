import { describe, it, expect } from 'vitest';

import { evaluateTenantAccess, membershipInTenant, type TenantAccessInput } from '../src/authz/tenantAccess.js';

// This deployment is Che Pizza's.
const OWN_BRAND = '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47';
const TAGGI = 'af941888-ec4c-458e-b905-21673241af3e';
const LISSARO = 'f103ce67-ad79-4bf6-99ca-1d632caf7786';

// Another client entirely.
const OTHER_BRAND = 'd290f1ee-6c54-4b01-90e6-d701748f0851';
const OTHER_BIZ = 'c1a4d3f4-4f4b-4e2d-9c3a-5f8e2b2c3d4e';

const STAFF_ROLES = new Set(['admin', 'brand_manager', 'manager', 'owner', 'staff']);
const CUSTOMER_ROLES = new Set([...STAFF_ROLES, 'user']);
const SERVICES = new Set(['campaign-service', 'messaging-service', 'user-service', 'business-service']);

function decide(overrides: Partial<TenantAccessInput> = {}) {
  return evaluateTenantAccess({
    auth: null,
    memberships: [],
    ownBrandId: OWN_BRAND,
    ownBusinessIds: [TAGGI, LISSARO],
    allowedRoles: STAFF_ROLES,
    allowedServices: SERVICES,
    requireTenantScopedServiceTokens: false,
    ...overrides,
  });
}

describe('membershipInTenant', () => {
  it('matches on brandId', () => {
    expect(membershipInTenant({ brandId: OWN_BRAND, businessId: null }, OWN_BRAND, [TAGGI])).toBe(true);
  });

  it('matches a legacy row that only carries a businessId', () => {
    expect(membershipInTenant({ brandId: null, businessId: LISSARO }, OWN_BRAND, [TAGGI, LISSARO])).toBe(true);
  });

  it('rejects another brand', () => {
    expect(membershipInTenant({ brandId: OTHER_BRAND, businessId: OTHER_BIZ }, OWN_BRAND, [TAGGI])).toBe(false);
  });

  it('rejects a membership with neither key', () => {
    expect(membershipInTenant({ brandId: null, businessId: null }, OWN_BRAND, [TAGGI])).toBe(false);
  });
});

describe('user access', () => {
  // THE regression this whole change exists for.
  it('refuses staff of another brand (was: full CRM + stamping access)', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OTHER_BRAND, businessId: OTHER_BIZ, roles: ['staff'] }],
    });
    expect(d.allow).toBe(false);
    expect(d).toMatchObject({ status: 403, error: 'FORBIDDEN' });
    expect(d.warn).toBe('refused caller holding memberships only in other tenants');
  });

  it('refuses an admin of another brand', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OTHER_BRAND, businessId: null, roles: ['admin'] }],
    });
    expect(d.allow).toBe(false);
  });

  it('admits own-brand staff', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OWN_BRAND, businessId: TAGGI, roles: ['staff'] }],
    });
    expect(d).toEqual({ allow: true, via: 'membership' });
  });

  it('admits own-brand staff whose membership is on the second location', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: null, businessId: LISSARO, roles: ['manager'] }],
    });
    expect(d.allow).toBe(true);
  });

  it('picks the own-brand membership out of a mixed set', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [
        { brandId: OTHER_BRAND, businessId: OTHER_BIZ, roles: ['admin'] },
        { brandId: OWN_BRAND, businessId: TAGGI, roles: ['staff'] },
      ],
    });
    expect(d.allow).toBe(true);
  });

  it('does not let a role held elsewhere satisfy this brand', () => {
    // The precise old bug: roles were collected across all memberships.
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [
        { brandId: OTHER_BRAND, businessId: OTHER_BIZ, roles: ['admin'] },
        { brandId: OWN_BRAND, businessId: TAGGI, roles: ['user'] },
      ],
    });
    expect(d.allow).toBe(false);
  });

  it('keeps customers out of staff routes', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OWN_BRAND, businessId: TAGGI, roles: ['user'] }],
    });
    expect(d.allow).toBe(false);
  });

  // Guards the behaviour of the two allowUserAccess routes (wallet), which
  // must stay reachable by this brand's customers and no one else's.
  it('admits an own-brand customer on an allowUserAccess route', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OWN_BRAND, businessId: TAGGI, roles: ['user'] }],
      allowedRoles: CUSTOMER_ROLES,
    });
    expect(d.allow).toBe(true);
  });

  it('still refuses another brand customer on an allowUserAccess route', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OTHER_BRAND, businessId: OTHER_BIZ, roles: ['user'] }],
      allowedRoles: CUSTOMER_ROLES,
    });
    expect(d.allow).toBe(false);
  });

  it('refuses a caller with no memberships at all', () => {
    expect(decide({ auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' }, memberships: [] }).allow).toBe(false);
  });

  it('refuses an unauthenticated caller', () => {
    expect(decide({ auth: null, memberships: [] }).allow).toBe(false);
  });

  it('falls back to brandId matching when the location list is unavailable', () => {
    // getBrandBusinessIds() failed; brand-scoped members must still work.
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OWN_BRAND, businessId: TAGGI, roles: ['staff'] }],
      ownBusinessIds: [],
    });
    expect(d.allow).toBe(true);
  });
});

describe('service tokens', () => {
  it('refuses a service token bound to another brand', () => {
    const d = decide({ auth: { azp: 'business-service:altro', sub: 'business-service:altro', brandId: OTHER_BRAND } });
    expect(d).toMatchObject({ allow: false, status: 403, error: 'CROSS_TENANT_FORBIDDEN' });
  });

  it('admits a service token bound to this brand', () => {
    const d = decide({ auth: { azp: 'business-service:chepizza', sub: 'business-service:chepizza', brandId: OWN_BRAND } });
    expect(d).toEqual({ allow: true, via: 'service' });
  });

  it('accepts a legacy tenant-blind token during the rotation window', () => {
    const d = decide({ auth: { azp: 'business-service', sub: 'business-service' } });
    expect(d.allow).toBe(true);
    expect(d.warn).toMatch(/rotation window/);
  });

  it('refuses a legacy tenant-blind token once the flag is on', () => {
    const d = decide({
      auth: { azp: 'business-service', sub: 'business-service' },
      requireTenantScopedServiceTokens: true,
    });
    expect(d).toMatchObject({ allow: false, status: 403, error: 'TENANT_BLIND_SERVICE_TOKEN' });
  });

  it('recognises a service identity carried in aud', () => {
    const d = decide({ auth: { aud: ['campaign-service'], sub: 'campaign-service', brandId: OWN_BRAND } });
    expect(d.allow).toBe(true);
  });

  it('does not treat an unknown client id as a service', () => {
    // Falls through to the membership path, which has nothing → refused.
    const d = decide({ auth: { azp: 'some-random-client', sub: 'some-random-client', brandId: OWN_BRAND }, memberships: [] });
    expect(d).toMatchObject({ allow: false, error: 'FORBIDDEN' });
  });

  // The widest hole found in this pass, and the reason `sub === client_id`
  // exists. signAccessToken defaults every USER token to azp='user-service',
  // and 'user-service' is in the allowed-services list — so before this check
  // every authenticated person, of any brand, took the service branch and
  // skipped the role gate outright. A customer could call the CRM.
  it('does not accept a user token merely because azp is a known service name', () => {
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person' },
      memberships: [{ brandId: OTHER_BRAND, businessId: OTHER_BIZ, roles: ['user'] }],
    });
    expect(d).toMatchObject({ allow: false, error: 'FORBIDDEN' });
  });

  it('does not accept a user token whose brandId claim was somehow set', () => {
    // Even a forged-looking brand claim buys nothing without sub === client_id.
    const d = decide({
      auth: { azp: 'user-service', sub: 'keycloak-sub-of-a-person', brandId: OWN_BRAND },
      memberships: [],
    });
    expect(d.allow).toBe(false);
  });
});
