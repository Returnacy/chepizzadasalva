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
function matchesAllowedService(candidate, allowed) {
    if (allowed.has(candidate))
        return true;
    const base = candidate.split(':')[0] ?? '';
    return base.length > 0 && allowed.has(base);
}
/** A membership counts only if it names this brand, or a location of it. */
export function membershipInTenant(membership, ownBrandId, ownBusinessIds) {
    if (!membership)
        return false;
    if (membership.brandId && membership.brandId === ownBrandId)
        return true;
    // Older rows carry a businessId with a null brandId, hence the second key.
    if (membership.businessId && ownBusinessIds.includes(membership.businessId))
        return true;
    return false;
}
const STAFF_ROLES = new Set(['admin', 'brand_manager', 'manager', 'owner', 'staff']);
/**
 * Does the caller work here, as opposed to being one of this brand's customers?
 * Customer-facing routes use it to decide whether a `userId` in the query may
 * name someone else.
 */
export function callerIsBrandStaff(memberships, ownBrandId, ownBusinessIds) {
    return (Array.isArray(memberships) ? memberships : [])
        .filter((m) => membershipInTenant(m, ownBrandId, ownBusinessIds))
        .some((m) => Array.isArray(m.roles) && m.roles.some((r) => STAFF_ROLES.has(String(r).toLowerCase())));
}
export function evaluateTenantAccess(input) {
    const { auth, memberships, ownBrandId, ownBusinessIds, allowedRoles, allowedServices } = input;
    if (auth) {
        const azp = typeof auth.azp === 'string' ? auth.azp : undefined;
        const sub = typeof auth.sub === 'string' ? auth.sub : undefined;
        const audClaim = auth.aud;
        const audList = Array.isArray(audClaim)
            ? audClaim.map(String)
            : typeof audClaim === 'string'
                ? [audClaim]
                : [];
        // `sub === client_id` is what actually distinguishes a service token:
        // signServiceToken does .setSubject(claims.azp), while a user token's
        // subject is the person's keycloakSub.
        //
        // Without this test the check was catastrophically wide: every user token
        // carries azp='user-service' (signAccessToken's default) and 'user-service'
        // is in the allowed-services list — so EVERY authenticated user, of any
        // brand, took the service branch and skipped the role check entirely. The
        // role gate below has effectively never run in production.
        const candidateIds = [azp, ...audList].filter((v) => typeof v === 'string' && v.length > 0);
        const isService = sub !== undefined
            && candidateIds.some((id) => id === sub && matchesAllowedService(id, allowedServices));
        if (isService) {
            // A service token skips every check below, so it has to prove its tenant.
            const tokenBrandId = typeof auth.brandId === 'string' && auth.brandId.length > 0 ? auth.brandId : null;
            if (tokenBrandId) {
                if (tokenBrandId !== ownBrandId) {
                    return {
                        allow: false,
                        status: 403,
                        error: 'CROSS_TENANT_FORBIDDEN',
                        warn: 'cross-tenant service token refused',
                    };
                }
                return { allow: true, via: 'service' };
            }
            if (input.requireTenantScopedServiceTokens) {
                return {
                    allow: false,
                    status: 403,
                    error: 'TENANT_BLIND_SERVICE_TOKEN',
                    warn: 'tenant-blind service token refused',
                };
            }
            return { allow: true, via: 'service', warn: 'tenant-blind service token accepted during rotation window' };
        }
    }
    const list = Array.isArray(memberships) ? memberships : [];
    const inTenant = list.filter((m) => membershipInTenant(m, ownBrandId, ownBusinessIds));
    const hasRole = inTenant.some((m) => Array.isArray(m.roles) && m.roles.some((role) => allowedRoles.has(String(role).toLowerCase())));
    if (hasRole)
        return { allow: true, via: 'membership' };
    return {
        allow: false,
        status: 403,
        error: 'FORBIDDEN',
        message: 'Requires staff or higher role',
        // The signal worth alerting on: a real user, with real roles, none of them here.
        warn: list.length > 0 && inTenant.length === 0
            ? 'refused caller holding memberships only in other tenants'
            : undefined,
    };
}
