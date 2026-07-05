type LoyaltyPassParams = {
    userId: string;
    accountName: string;
    accountEmail?: string;
    businessId: string;
    qrValue: string;
    validStamps?: number;
    origins?: string[];
};
type LoyaltyPassResult = {
    jwt: string;
    saveUrl: string;
    objectId: string;
    classId: string;
    expiresAt: string;
};
export declare function createLoyaltySaveJwt(params: LoyaltyPassParams): Promise<LoyaltyPassResult>;
export {};
//# sourceMappingURL=googleWallet.d.ts.map