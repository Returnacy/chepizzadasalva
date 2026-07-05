type WalletScope = 'LOCATION' | 'BRAND';
export declare class RepositoryPrisma {
    brandId: string;
    businessId: string;
    private _walletScope;
    private _brandBusinessIds;
    constructor();
    getWalletScope(): Promise<WalletScope>;
    getBrandBusinessIds(): Promise<string[]>;
    isBusinessInBrand(businessId: string): Promise<boolean>;
    listBrandLocations(): Promise<{
        id: string;
        name: string;
        address: string;
    }[]>;
    private walletBusinessFilter;
    listPrizes(): Promise<{
        id: string;
        brandId: string | null;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        businessId: string | null;
        pointsRequired: number;
        isPromotional: boolean;
    }[]>;
    listNonPromotionalPrizes(): Promise<{
        id: string;
        brandId: string | null;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        businessId: string | null;
        pointsRequired: number;
        isPromotional: boolean;
    }[]>;
    createPrize(p: {
        name: string;
        pointsRequired: number;
        isPromotional?: boolean;
        businessId?: string | null;
        brandId?: string | null;
    }): Promise<{
        id: string;
        brandId: string | null;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        businessId: string | null;
        pointsRequired: number;
        isPromotional: boolean;
    }>;
    getLastNonPromotionalPrize(userId: string): Promise<{
        id: string;
        brandId: string | null;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        businessId: string | null;
        pointsRequired: number;
        isPromotional: boolean;
    } | null>;
    getNextNonPromotionalPrize(userId: string): Promise<{
        id: string;
        brandId: string | null;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        businessId: string | null;
        pointsRequired: number;
        isPromotional: boolean;
    } | null>;
    addStamp(userId: string, businessId: string): Promise<{
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        isRedeemed: boolean;
    }>;
    listStamps(userId: string, businessId: string, filter?: {
        isRedeemed?: boolean;
    }): Promise<{
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        isRedeemed: boolean;
    }[]>;
    redeemStamp(stampId: string): Promise<{
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        isRedeemed: boolean;
    }>;
    countValidStamps(userId: string, businessId: string): Promise<number>;
    createCoupon(userId: string, businessId: string, prizeId: string, code: string, expiredAt?: Date | null): Promise<{
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    }>;
    getCouponById(couponId: string): Promise<({
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    }) | null>;
    findCouponByCode(code: string, businessId: string): Promise<({
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    }) | null>;
    redeemCoupon(couponId: string, redeemedBusinessId?: string | null): Promise<{
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    }>;
    listCoupons(userId: string, businessId: string): Promise<({
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    })[]>;
    listNonPromotionalCoupons(userId: string, businessId: string): Promise<({
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    })[]>;
    getLastNonPromotionalCoupon(userId: string): Promise<({
        prize: {
            id: string;
            brandId: string | null;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            businessId: string | null;
            pointsRequired: number;
            isPromotional: boolean;
        };
    } & {
        id: string;
        createdAt: Date;
        businessId: string;
        userId: string;
        prizeId: string;
        code: string;
        isRedeemed: boolean;
        expiredAt: Date | null;
        redeemedAt: Date | null;
        redeemedBusinessId: string | null;
    }) | null>;
    getBusinessCapacity(businessId: string): Promise<{
        email: number;
        sms: number;
        push: number;
    } | null>;
    private bizWhere;
    private bizArray;
    countStampsInRange(businessId: string | string[], from: Date, to: Date): Promise<number>;
    countRedeemedCouponsInRange(businessId: string | string[], from: Date, to: Date): Promise<number>;
    countTotalCouponsRedeemed(businessId: string | string[]): Promise<number>;
    distinctUsersForBusiness(businessId: string | string[]): Promise<number>;
    countNewUsersSince(businessId: string | string[], since: Date): Promise<number>;
    private getDateRange;
    getDailyStamps(businessId: string | string[], startDate: Date, endDate?: Date): Promise<number[]>;
    getDailyTransactionsSessions(businessId: string | string[], startDate: Date, endDate?: Date): Promise<number[]>;
    calculateReturnacyRate(businessId: string | string[], days?: number): Promise<number>;
    calculateAverageUserFrequency(businessId: string | string[], days?: number): Promise<number>;
    getUsersStatsForBusiness(userIds: string[], businessId: string | string[]): Promise<Map<string, {
        totalStamps: number;
        validStamps: number;
        couponsCount: number;
        totalCoupons: number;
        lastVisit: Date | null;
    }>>;
    getUserStatsForBusiness(userId: string, businessId: string): Promise<{
        totalStamps: number;
        validStamps: number;
        couponsCount: number;
        totalCoupons: number;
        lastVisit: Date | null;
    }>;
    stampsByLocation(from: Date, to: Date): Promise<Map<string, number>>;
    redeemedCouponsByLocation(from: Date, to: Date): Promise<Map<string, number>>;
    activeCustomersByLocation(from: Date, to: Date): Promise<Map<string, number>>;
    firstStampAcquisitionByLocation(from: Date, to: Date): Promise<Map<string, number>>;
    metricsByLocation(from: Date, to: Date): Promise<{
        businessId: string;
        name: string;
        stamps: number;
        couponsRedeemed: number;
        newCustomers: number;
        activeCustomers: number;
    }[]>;
    dailyStampsByLocation(startDate: Date): Promise<Array<{
        date: string;
        businessId: string;
        count: number;
    }>>;
    acquisitionDailyByLocation(startDate: Date): Promise<Array<{
        date: string;
        businessId: string;
        count: number;
    }>>;
    crossLocationRedemptions(from: Date, to: Date): Promise<Array<{
        earnedBusinessId: string;
        redeemedBusinessId: string;
        count: number;
    }>>;
    retentionByLocation(days?: number): Promise<Array<{
        businessId: string;
        total: number;
        active: number;
        atRisk: number;
        lost: number;
    }>>;
    rewardFunnel(from: Date, to: Date): Promise<{
        businessId: string;
        name: string;
        stamps: number;
        earned: number;
        redeemed: number;
        expired: number;
    }[]>;
    stampHeatmap(from: Date, to: Date, businessId?: string | null): Promise<Array<{
        dow: number;
        hour: number;
        count: number;
    }>>;
}
export {};
//# sourceMappingURL=repository.prisma.d.ts.map