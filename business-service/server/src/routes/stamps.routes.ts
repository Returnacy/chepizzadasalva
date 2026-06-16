import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { TokenService } from '../services/tokenService.js';
import { UserServiceClient } from '../services/userServiceClient.js';

export function registerStampsRoutes(app: FastifyInstance) {
  app.post('/api/v1/stamps', async (request: any) => {
    // Backward-compatible single-stamp endpoint (deprecated by batch below)
    const { userId, businessId } = request.body as { userId: string; businessId: string };
    const stamp = await app.repository.addStamp(userId, businessId);
    return { stamp };
  });

  app.patch('/api/v1/stamps/:id/redeem', async (request: any) => {
    const { id } = request.params as { id: string };
    const stamp = await app.repository.redeemStamp(id);
    return { stamp };
  });

  app.get('/api/v1/stamps/count', async (request: any) => {
    const { userId, businessId } = request.query as { userId: string; businessId: string };
    const count = await app.repository.countValidStamps(userId, businessId);
    return { count };
  });

  // New: batch stamps apply with coupon evaluation and user-service sync
  app.post('/api/v1/stamps/apply', async (request: any, reply: any) => {
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

    // 1) Add N stamps in business DB
    for (let i = 0; i < input.stamps; i++) {
      await app.repository.addStamp(input.userId, input.businessId);
    }

    // 2) Compute valid stamps and evaluate next non-promotional prize entitlement
    const validStamps = await app.repository.countValidStamps(input.userId, input.businessId);
    const nextPrize = await app.repository.getNextNonPromotionalPrize(input.userId);
    const lastPrize = await app.repository.getLastNonPromotionalPrize(input.userId);
    
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
    
    if (nextPrize && validStamps >= stampsNeededForNextPrize!) {
      // Eligible for next prize - create coupon and redeem corresponding stamps
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      createdCoupon = await app.repository.createCoupon(
        input.userId,
        input.businessId,
        nextPrize.id,
        code,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      );

      consumedStampsAfter = (lastPrize ? lastPrize.pointsRequired : 0) + nextPrize.pointsRequired;
      const stampsToRedeem = consumedStampsAfter;
      const stamps = await app.repository.listStamps(input.userId, input.businessId, { isRedeemed: false });
      let redeemedCount = 0;
      for (const stamp of stamps) {
        if (redeemedCount >= stampsToRedeem) break;
        await app.repository.redeemStamp(stamp.id);
        redeemedCount++;
      }
    }

    // 3) Sync counters to user-service via internal service-auth endpoint.
    // This is best-effort: the chepizza DB is the source of truth, so a sync
    // failure must NOT cause the staff's request to fail. Otherwise the staff
    // sees an error and assumes no coupon was created — but the coupon WAS
    // created here in chepizza's DB and would only become visible on reload.
    try {
      const tokenService = TokenService.fromEnv();
      const userClient = new UserServiceClient({
        baseUrl: process.env.USER_SERVICE_URL || 'http://user-server:3000',
        tokenService,
        timeoutMs: 5000,
      });
      await userClient.updateMembershipCounters({
        userId: input.userId,
        businessId: input.businessId,
        // Under a BRAND wallet the counters live on the brand-scoped membership,
        // not on a per-location one (which may not exist for this location) — so
        // tell user-service to resolve the membership by brand.
        brandId: app.repository.brandId,
        scope: await app.repository.getWalletScope(),
        validStamps: createdCoupon? validStamps - stampsNeededForNextPrize : validStamps,
        validCoupons: createdCoupon ? 1 : 0,
        totalStampsDelta: input.stamps,
        totalCouponsDelta: createdCoupon ? 1 : 0,
      });
    } catch (err) {
      app.log.error(
        { err, userId: input.userId, businessId: input.businessId, couponCreated: !!createdCoupon },
        '[business-service] membership counter sync to user-service failed; coupon and stamp redemption already persisted in chepizza DB',
      );
    }

    return reply.code(200).send({
      message: 'Stamps applied',
      data: {
        validStamps: createdCoupon? validStamps - stampsNeededForNextPrize : validStamps,
        createdCoupon: createdCoupon ? { id: createdCoupon.id, code: createdCoupon.code } : null,
      },
    });
  });
}
