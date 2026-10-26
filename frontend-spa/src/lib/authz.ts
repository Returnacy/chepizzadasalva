import { getBusinessId } from './servicesHttp';
import type { ClientType } from '../types/client';

// Define the roles your app recognizes in ascending order of privilege.
// 'brand_manager' (lowercased BRAND_MANAGER) sits between manager and admin so
// unknown-role handling in roleRank() ranks it correctly instead of flooring it
// to 0 (which would let a plain manager clear a brand_manager-gated check).
export type Role = 'user' | 'staff' | 'manager' | 'brand_manager' | 'admin' | string;
const ROLE_ORDER: Role[] = ['user', 'staff', 'manager', 'brand_manager', 'admin'];

export type TenantContext = { businessId?: string | null; brandId?: string | null };

export function getTenantContext(): TenantContext {
  const businessId = getBusinessId();
  const brandId = (import.meta as any).env?.VITE_BRAND_ID || null;
  return { businessId, brandId };
}

function normalize(v?: string | null): string {
  return (v || '').toString().trim().toLowerCase();
}

function roleRank(role: Role): number {
  const idx = ROLE_ORDER.indexOf(normalize(role) as Role);
  return idx >= 0 ? idx : 0; // unknown roles treated as lowest
}

// A membership belongs to the current tenant when it names this build's brand or
// this build's business (the staff's chosen location, else the build default).
// Same rule as business-service's membershipInTenant: older rows carry only a
// businessId, newer ones a brandId too. An empty context matches nothing.
function membershipInTenant(m: any, ctx: TenantContext): boolean {
  const bid = normalize(ctx.businessId || null);
  const brd = normalize(ctx.brandId || null);
  if (bid && normalize(m?.businessId) === bid) return true;
  if (brd && normalize(m?.brandId) === brd) return true;
  return false;
}

function tenantMemberships(user: ClientType | null | undefined, ctx?: TenantContext): any[] {
  if (!user || !Array.isArray((user as any).memberships)) return [];
  const c = ctx || getTenantContext();
  return ((user as any).memberships as any[]).filter((m) => membershipInTenant(m, c));
}

/** True when the user holds a membership (any role) in the current tenant. */
export function isTenantMember(user: ClientType | null | undefined, ctx?: TenantContext): boolean {
  return tenantMemberships(user, ctx).length > 0;
}

// Roles come only from memberships in the current tenant. There is deliberately
// no fallback (top-level user.role, or every membership the account holds):
// either one let a brand's staff into another brand's staff UI.
export function getRolesForContext(user: ClientType | null | undefined, ctx?: TenantContext): Role[] {
  const roles: Role[] = [];
  for (const m of tenantMemberships(user, ctx)) {
    if (m.role) roles.push((m.role as string).toLowerCase());
    if (Array.isArray(m.roles)) roles.push(...m.roles.map((r: string) => r.toLowerCase()));
  }
  return Array.from(new Set(roles));
}

export function getHighestRole(user: ClientType | null | undefined, ctx?: TenantContext): Role | null {
  const roles = getRolesForContext(user, ctx);
  if (roles.length === 0) return null;
  return roles.reduce((best, r) => (roleRank(r) > roleRank(best)) ? r : best, roles[0]);
}

export function hasAnyRole(user: ClientType | null | undefined, required: Role[] | undefined, ctx?: TenantContext): boolean {
  if (!required || required.length === 0) return true; // no restriction
  const userRoles = getRolesForContext(user, ctx);
  if (userRoles.length === 0) return false;
  const normalizedRequired = required.map(r => normalize(r));
  return userRoles.some(r => normalizedRequired.includes(normalize(r)) || roleRank(r) >= Math.max(...normalizedRequired.map(roleRank)));
}

// Simple policy gate: resource/action → minimum role
type Policy = Record<string, { [action: string]: Role }>; // e.g., { 'campaigns': { 'create': 'manager', 'publish': 'admin' } }

export function makeAuthorizer(policy: Policy) {
  return {
    can(user: ClientType | null | undefined, resource: string, action: string, ctx?: TenantContext): boolean {
      const minRole = policy[resource]?.[action];
      if (!minRole) return true; // no rule → allow
      const highest = getHighestRole(user, ctx);
      if (!highest) return false;
      return roleRank(highest) >= roleRank(minRole);
    }
  };
}
