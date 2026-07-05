import type { TokenService } from './tokenService.js';
export type QueryUsersParams = {
    page?: number;
    limit?: number;
    offset?: number;
    search?: string;
    businessId?: string;
    brandId?: string;
    minStamp?: number;
    sortBy?: 'name' | 'stamp' | 'coupon' | 'lastVisit';
    sortOrder?: 'asc' | 'desc';
    filters?: {
        minStamps?: number;
        couponsOnly?: boolean;
        lastVisitDays?: number | null;
    };
};
export type BasicUser = {
    id: string;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
    surname?: string | null;
    birthday?: string | null;
};
export declare class UserServiceClient {
    private http;
    private tokenService;
    constructor(opts: {
        baseUrl: string;
        tokenService: TokenService;
        timeoutMs?: number;
    });
    private authHeaders;
    queryUsers(params: QueryUsersParams): Promise<BasicUser[]>;
    updateMembershipCounters(args: {
        userId: string;
        businessId: string;
        brandId?: string;
        scope?: 'LOCATION' | 'BRAND';
        validStamps?: number;
        validCoupons?: number;
        totalStampsDelta?: number;
        totalCouponsDelta?: number;
    }): Promise<void>;
    getWalletPass(userId: string, businessId: string): Promise<{
        linked: boolean;
        objectId: string | null;
        walletPass?: any;
    } | null>;
    upsertWalletPass(userId: string, businessId: string, payload: {
        objectId?: string | null;
    }): Promise<{
        linked: boolean;
        objectId: string | null;
        walletPass?: any;
    }>;
    countUsers(scope: {
        businessId?: string;
        brandId?: string;
    }): Promise<number>;
    countNewUsers(scope: {
        businessId?: string;
        brandId?: string;
    }, since: Date): Promise<number>;
    countUsersByBusiness(businessId: string): Promise<number>;
    countNewUsersSince(businessId: string, since: Date): Promise<number>;
}
//# sourceMappingURL=userServiceClient.d.ts.map