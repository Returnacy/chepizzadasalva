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
/**
 * Whether this deployment can issue Google Wallet passes, answered WITHOUT
 * throwing (readEnv does throw). A brand provisioned without the Wallet env is
 * a normal, supported state: the SPA asks this so it can leave the "Add to
 * Google Wallet" button out entirely instead of showing one that 500s.
 */
export declare function isWalletConfigured(): boolean;
export declare function createLoyaltySaveJwt(params: LoyaltyPassParams): Promise<LoyaltyPassResult>;
export {};
//# sourceMappingURL=googleWallet.d.ts.map