type Membership = {
    brandId: string | null;
    businessId: string | null;
    roles: string[];
};
declare module 'fastify' {
    interface FastifyRequest {
        userMemberships?: Membership[];
    }
}
declare const _default: any;
export default _default;
//# sourceMappingURL=userAuthPlugin.d.ts.map