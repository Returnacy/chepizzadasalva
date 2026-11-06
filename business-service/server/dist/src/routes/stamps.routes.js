import { z } from 'zod';
import crypto from 'node:crypto';
import { TokenService } from '../services/tokenService.js';
import { UserServiceClient } from '../services/userServiceClient.js';
export function registerStampsRoutes(app) {
    // One client per app instance, built on first use: TokenService caches the
    // service token, so reusing it saves a token mint per scan. Lazy because
    // fromEnv() throws on missing config, and that must stay a logged sync
    // failure, not a boot crash.
    let userClient = null;
    const getUserClient = () => {
        if (!userClient) {
            userClient = new UserServiceClient({
                baseUrl: process.env.USER_SERVICE_URL || 'http://user-server:3000',
                tokenService: TokenService.fromEnv(),
                timeoutMs: 5000,
            });
        }
        return userClient;
    };
    app.post('/api/v1/stamps', async (request, reply) => {
        // Backward-compatible single-stamp endpoint (deprecated by batch below)
        const { userId, businessId } = request.body;
        // Same location guard /apply has had all along: a stamp must land on a
        // location of this brand, not on an arbitrary id taken from the body.
        if (!(await app.repository.isBusinessInBrand(businessId))) {
            return reply.code(400).send({ message: 'Unknown location for this brand' });
        }
        const stamp = await app.repository.addStamp(userId, businessId);
        return { stamp };
    });
    app.patch('/api/v1/stamps/:id/redeem', async (request) => {
        const { id } = request.params;
        const stamp = await app.repository.redeemStamp(id);
        return { stamp };
    });
    app.get('/api/v1/stamps/count', async (request) => {
        const { userId, businessId } = request.query;
        const count = await app.repository.countValidStamps(userId, businessId);
        return { count };
    });
    // New: batch stamps apply with coupon evaluation and user-service sync
    app.post('/api/v1/stamps/apply', async (request, reply) => {
        const schema = z.object({
            userId: z.string().min(1),
            businessId: z.string().min(1),
            stamps: z.number().int().min(1).max(200),
        });
        const input = schema.parse(request.body ?? {});
        // Basic guard against accidental invalid identifiers propagated from UI
        const badIds = new Set(['NaN', 'undefined', 'null']);
        if (badIds.has(input.userId.trim())) {
            return reply.code(400).send({ message: 'Invalid userId' });
        }
        // Guard: the location being stamped at must belong to this brand. This both
        // catches a stale/forged businessId from the staff app and ensures the stamp
        // is attributed to a real location (the per-location data integrity contract).
        if (!(await app.repository.isBusinessInBrand(input.businessId))) {
            return reply.code(400).send({ message: 'Unknown location for this brand' });
        }
        // 1) Add N stamps in business DB (single insert)
        await app.repository.addStamps(input.userId, input.businessId, input.stamps);
        // 2) Compute valid stamps and evaluate next non-promotional prize entitlement
        const [validStamps, nextPrize, lastPrize] = await Promise.all([
            app.repository.countValidStamps(input.userId, input.businessId),
            app.repository.getNextNonPromotionalPrize(input.userId),
            app.repository.getLastNonPromotionalPrize(input.userId),
        ]);
        let stampsNeededForNextPrize;
        if (lastPrize && nextPrize) {
            if (lastPrize.pointsRequired < nextPrize.pointsRequired) {
                stampsNeededForNextPrize = nextPrize.pointsRequired - lastPrize.pointsRequired;
            }
            else {
                stampsNeededForNextPrize = nextPrize.pointsRequired;
            }
        }
        else if (!lastPrize) {
            stampsNeededForNextPrize = nextPrize.pointsRequired;
        }
        let createdCoupon = null;
        let consumedStampsAfter = 0;
        if (nextPrize && validStamps >= stampsNeededForNextPrize) {
            // Eligible for next prize - create coupon and redeem corresponding stamps
            const code = crypto.randomBytes(6).toString('hex').toUpperCase();
            createdCoupon = await app.repository.createCoupon(input.userId, input.businessId, nextPrize.id, code, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
            consumedStampsAfter = (lastPrize ? lastPrize.pointsRequired : 0) + nextPrize.pointsRequired;
            const stampsToRedeem = consumedStampsAfter;
            // Oldest valid stamps first, redeemed in one update.
            const stamps = await app.repository.listStamps(input.userId, input.businessId, { isRedeemed: false, take: stampsToRedeem });
            await app.repository.redeemStamps(stamps.map((stamp) => stamp.id));
        }
        const remainingValidStamps = createdCoupon ? validStamps - stampsNeededForNextPrize : validStamps;
        // Progression after this apply, same semantics as GET /api/v1/prizes/progression,
        // so the staff app can redraw without another round trip. A new coupon moves
        // the last/next prize, so re-read them only in that case.
        const [lastPrizeAfter, nextPrizeAfter] = createdCoupon
            ? await Promise.all([
                app.repository.getLastNonPromotionalPrize(input.userId),
                app.repository.getNextNonPromotionalPrize(input.userId),
            ])
            : [lastPrize, nextPrize];
        reply.code(200).send({
            message: 'Stamps applied',
            data: {
                validStamps: remainingValidStamps,
                createdCoupon: createdCoupon ? { id: createdCoupon.id, code: createdCoupon.code } : null,
                nextPrize: {
                    name: nextPrizeAfter?.name,
                    stampsLastPrize: lastPrizeAfter ? Number(lastPrizeAfter.pointsRequired) : 0,
                    stampsNextPrize: nextPrizeAfter ? Number(nextPrizeAfter.pointsRequired) : 0,
                },
            },
        });
        // 3) Sync counters to user-service via internal service-auth endpoint,
        // after the response is out. This is best-effort: the chepizza DB is the
        // source of truth, so a slow or failing sync must NOT hold up or fail the
        // staff's request — the coupon and stamps are already persisted here.
        void (async () => {
            try {
                await getUserClient().updateMembershipCounters({
                    userId: input.userId,
                    businessId: input.businessId,
                    // Under a BRAND wallet the counters live on the brand-scoped membership,
                    // not on a per-location one (which may not exist for this location) — so
                    // tell user-service to resolve the membership by brand.
                    brandId: app.repository.brandId,
                    scope: await app.repository.getWalletScope(),
                    validStamps: remainingValidStamps,
                    validCoupons: createdCoupon ? 1 : 0,
                    totalStampsDelta: input.stamps,
                    totalCouponsDelta: createdCoupon ? 1 : 0,
                });
            }
            catch (err) {
                app.log.error({ err, userId: input.userId, businessId: input.businessId, couponCreated: !!createdCoupon }, '[business-service] membership counter sync to user-service failed; coupon and stamp redemption already persisted in chepizza DB');
            }
        })();
        return reply;
    });
}
