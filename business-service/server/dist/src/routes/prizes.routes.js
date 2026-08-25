import { callerIsBrandStaff } from '../authz/tenantAccess.js';
export function registerPrizesRoutes(app) {
    // The prize catalogue is the same information already printed on the loyalty
    // card, and the customer app renders it.
    app.get('/api/v1/prizes', {
        config: { allowUserAccess: true },
        handler: async () => {
            const prizes = await app.repository.listPrizes();
            return { prizes };
        },
    });
    // Compute progression boundaries (last and next prize thresholds) given a user's current stamps
    // Input: { businessId: string, stamps: number }
    // Output: { stampsLastPrize: number, stampsNextPrize: number, lastPrizeName?: string, nextPrizeName?: string }
    // allowUserAccess for the same reason as GET /api/v1/coupons — see the note
    // there. A customer may only ask about their own progression.
    app.get('/api/v1/prizes/progression', {
        config: { allowUserAccess: true },
        handler: async (request, reply) => {
            let { userId } = request.query;
            const isStaff = callerIsBrandStaff(request.userMemberships ?? [], app.repository.brandId, await app.repository.getBrandBusinessIds().catch(() => []));
            if (!isStaff) {
                const self = request.selfUserId;
                if (!self)
                    return reply.code(403).send({ error: 'FORBIDDEN' });
                if (userId && String(userId) !== String(self)) {
                    return reply.code(403).send({ error: 'FORBIDDEN' });
                }
                userId = self;
            }
            const lastPrize = await app.repository.getLastNonPromotionalPrize(userId);
            const nextPrize = await app.repository.getNextNonPromotionalPrize(userId);
            return reply.send({
                stampsLastPrize: lastPrize ? Number(lastPrize.pointsRequired) : 0,
                stampsNextPrize: nextPrize ? Number(nextPrize.pointsRequired) : 0,
                lastPrizeName: lastPrize?.name,
                nextPrizeName: nextPrize?.name,
            });
        },
    });
}
