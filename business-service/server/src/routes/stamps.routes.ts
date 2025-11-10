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

    // 3) Sync counters to user-service via internal service-auth endpoint
    const tokenService = new TokenService({
      tokenUrl: process.env.KEYCLOAK_TOKEN_URL!,
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    });
    const userClient = new UserServiceClient({ baseUrl: process.env.USER_SERVICE_URL || 'http://user-server:3000', tokenService });

    const now = new Date();

    await userClient.updateMembershipCounters({
      userId: input.userId,
      businessId: input.businessId,
      validStamps: createdCoupon? validStamps - stampsNeededForNextPrize : validStamps,
      validCoupons: createdCoupon ? 1 : 0,
      totalStampsDelta: input.stamps,
      totalCouponsDelta: createdCoupon ? 1 : 0,
    });

    return reply.code(200).send({
      message: 'Stamps applied',
      data: {
        validStamps: createdCoupon? validStamps - stampsNeededForNextPrize : validStamps,
        createdCoupon: createdCoupon ? { id: createdCoupon.id, code: createdCoupon.code } : null,
      },
    });
  });
}
