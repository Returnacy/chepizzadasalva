/**
 * The access decision for this business-service deployment, as a pure function.
 *
 * It lives outside app.ts for one practical reason: app.ts can only be built
 * through prismaRepositoryPlugin, which imports the Prisma client from the
 * hardcoded container path `file:///app/db/dist/src/index.js`. That makes
 * `buildApp()` impossible to instantiate off a container, and an untestable
 * gate is how this class of bug survived in the first place.
 *
 * The rule: one deployment serves one brand. A caller gets in only if it
 * belongs to THAT brand — as a service credential bound to it, or as a member
 * of it holding a sufficient role.
 */
export type TenantMembership = {
    brandId?: string | null;
    businessId?: string | null;
    roles?: unknown;
};
export type TenantAccessInput = {
    /** Verified JWT payload, or null/undefined when unauthenticated. */
    auth: {
        azp?: unknown;
        aud?: unknown;
        sub?: unknown;
        brandId?: unknown;
    } | null | undefined;
    /** Memberships resolved for the caller (token claims or /me backfill). */
    memberships: TenantMembership[];
    /** Brand this deployment serves (DEFAULT_BRAND_ID). */
    ownBrandId: string;
    /** Locations of that brand; may be empty if the DB was unreachable. */
    ownBusinessIds: string[];
    /** Roles accepted on this route (includes 'user' for allowUserAccess routes). */
    allowedRoles: ReadonlySet<string>;
    /** Service client ids accepted, matched in full or on the part before ':'. */
    allowedServices: ReadonlySet<string>;
    /** When true, a service token without a brand claim is refused. */
    requireTenantScopedServiceTokens: boolean;
};
export type TenantAccessDecision = {
    allow: true;
    via: 'service' | 'membership';
    warn?: string;
} | {
    allow: false;
    status: number;
    error: string;
    message?: string;
    warn?: string;
};
/** A membership counts only if it names this brand, or a location of it. */
export declare function membershipInTenant(membership: TenantMembership, ownBrandId: string, ownBusinessIds: string[]): boolean;
/**
 * Does the caller work here, as opposed to being one of this brand's customers?
 * Customer-facing routes use it to decide whether a `userId` in the query may
 * name someone else.
 */
export declare function callerIsBrandStaff(memberships: TenantMembership[], ownBrandId: string, ownBusinessIds: string[]): boolean;
export declare function evaluateTenantAccess(input: TenantAccessInput): TenantAccessDecision;
//# sourceMappingURL=tenantAccess.d.ts.map