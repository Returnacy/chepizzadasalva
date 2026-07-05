// @ts-nocheck
import axios from 'axios';
export class UserServiceClient {
    http;
    tokenService;
    constructor(opts) {
        this.http = axios.create({
            baseURL: opts.baseUrl.replace(/\/$/, ''),
            timeout: opts.timeoutMs ?? 5000,
        });
        this.tokenService = opts.tokenService;
    }
    async authHeaders() {
        const token = await this.tokenService.getAccessToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    async queryUsers(params) {
        // If the real user-service is running, call its internal query endpoint with service auth.
        const headers = await this.authHeaders();
        const limit = Math.max(1, Math.min(Math.trunc(params.limit ?? 50), 200));
        const page = Math.max(1, Math.trunc(params.page ?? 1));
        const offsetParam = params.offset;
        const offset = Number.isFinite(offsetParam) ? Math.max(0, Math.trunc(offsetParam)) : (page - 1) * limit;
        const payload = {
            // For free-text search we rely on the user-service 'search' param (OR across name/email/phone),
            // so we intentionally do NOT include targetingRules here to avoid AND-restricting by email only.
            limit,
            page,
            // Under a BRAND wallet, scope the CRM to the whole brand; otherwise to the
            // single location. user-service honours brandId when businessId is absent.
            businessId: params.brandId ? null : (params.businessId ?? null),
            brandId: params.brandId ?? undefined,
            search: params.search || undefined,
        };
        if (offset > 0)
            payload.offset = offset;
        if (params.minStamp !== undefined)
            payload.minStamp = params.minStamp;
        if (params.sortBy)
            payload.sortBy = params.sortBy;
        if (params.sortOrder)
            payload.sortOrder = params.sortOrder;
        if (params.filters)
            payload.filters = params.filters;
        const res = await this.http.post('/internal/v1/users/query', payload, { headers });
        const users = res.data?.users ?? [];
        return users.map(u => ({
            id: String(u.id),
            email: u.email ?? null,
            phone: u.phone ?? null,
            name: u.firstName ?? null,
            surname: u.lastName ?? null,
            birthday: u.attributes?.birthday ?? null,
        }));
    }
    async updateMembershipCounters(args) {
        const headers = await this.authHeaders();
        await this.http.post(`/internal/v1/users/${encodeURIComponent(args.userId)}/memberships/counters`, {
            businessId: args.businessId,
            brandId: args.brandId,
            scope: args.scope,
            validStamps: args.validStamps,
            validCoupons: args.validCoupons,
            totalStampsDelta: args.totalStampsDelta,
            totalCouponsDelta: args.totalCouponsDelta,
        }, { headers });
    }
    async getWalletPass(userId, businessId) {
        const headers = await this.authHeaders();
        try {
            const res = await this.http.get(`/internal/v1/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(businessId)}/wallet-pass`, { headers });
            return res.data ?? null;
        }
        catch (error) {
            const status = error?.response?.status;
            if (status === 404) {
                return { linked: false, objectId: null };
            }
            throw error;
        }
    }
    async upsertWalletPass(userId, businessId, payload) {
        const headers = await this.authHeaders();
        const res = await this.http.post(`/internal/v1/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(businessId)}/wallet-pass`, { objectId: payload.objectId }, { headers });
        return res.data ?? { linked: true, objectId: payload.objectId ?? null };
    }
    // Scope a customer count to a single location or the whole brand. user-service
    // counts by brand when brandId is sent and businessId is omitted.
    async countUsers(scope) {
        const headers = await this.authHeaders();
        const params = scope.brandId ? { brandId: scope.brandId } : { businessId: scope.businessId };
        const res = await this.http.get(`/internal/v1/users/count`, { params, headers });
        const count = res.data?.count ?? res?.count;
        return Number.isFinite(count) ? Number(count) : 0;
    }
    async countNewUsers(scope, since) {
        const headers = await this.authHeaders();
        const params = scope.brandId
            ? { brandId: scope.brandId, since: since.toISOString() }
            : { businessId: scope.businessId, since: since.toISOString() };
        const res = await this.http.get(`/internal/v1/users/count-new`, { params, headers });
        const count = res.data?.count ?? res?.count;
        return Number.isFinite(count) ? Number(count) : 0;
    }
    // Back-compat single-location wrappers.
    async countUsersByBusiness(businessId) {
        return this.countUsers({ businessId });
    }
    async countNewUsersSince(businessId, since) {
        return this.countNewUsers({ businessId }, since);
    }
}
