export type TokenServiceConfig = {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
};
export type GetAccessTokenOptions = {
    mode?: 'service' | 'admin';
    scope?: string;
};
export declare class TokenService {
    private clientId;
    private clientSecret;
    private tokenUrl;
    private cache;
    constructor(config: TokenServiceConfig);
    static fromEnv(): TokenService;
    getAccessToken(opts?: GetAccessTokenOptions): Promise<string>;
}
//# sourceMappingURL=tokenService.d.ts.map