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
    const prizes = await app.repository.listPrizes({ businessId: input.businessId });
    const coupons = await app.repository.listCoupons(input.userId, input.businessId);

    const nonPromotionalPrizes = prizes
      .filter((p: any) => !p.isPromotional)
      .map((p: any) => ({ ...p, pointsRequired: Number(p.pointsRequired) || 0 }))
      .filter((p: any) => p.pointsRequired > 0)
      .sort((a: any, b: any) => a.pointsRequired - b.pointsRequired);

    const nonPromotionalCoupons = coupons.filter((c: any) => c.prize && c.prize.isPromotional === false);
    const totalAwardedPoints = nonPromotionalCoupons.reduce((sum: number, coupon: any) => {
      const points = Number(coupon.prize?.pointsRequired ?? 0);
      return Number.isFinite(points) ? sum + points : sum;
    }, 0);

    const lastNonPromotionalCoupon = nonPromotionalCoupons.reduce((latest: any | null, current: any) => {
      if (!current) return latest;
      if (!latest) return current;
      const latestTs = latest.createdAt instanceof Date ? latest.createdAt.getTime() : new Date(latest.createdAt ?? 0).getTime();
      const currentTs = current.createdAt instanceof Date ? current.createdAt.getTime() : new Date(current.createdAt ?? 0).getTime();
      return currentTs > latestTs ? current : latest;
    }, null);

    let targetPrize: any | null = null;
    if (nonPromotionalPrizes.length > 0) {
      if (!lastNonPromotionalCoupon || !lastNonPromotionalCoupon.prize) {
        targetPrize = nonPromotionalPrizes[0];
      } else {
        const lastIndex = nonPromotionalPrizes.findIndex((p: any) => p.id === lastNonPromotionalCoupon.prize.id);
        const nextIndex = lastIndex >= 0 ? (lastIndex + 1) % nonPromotionalPrizes.length : 0;
        targetPrize = nonPromotionalPrizes[nextIndex];
      }
    }

    let createdCoupon: any = null;
    if (targetPrize) {
      const required = Number(targetPrize.pointsRequired ?? 0);
      const availableStamps = Math.max(0, validStamps - totalAwardedPoints);
      if (required > 0 && availableStamps >= required) {
        const code = crypto.randomUUID();
        createdCoupon = await app.repository.createCoupon(input.userId, input.businessId, targetPrize.id, code);
        coupons.push(createdCoupon);
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
    const unredeemedCount = coupons.filter((c: any) => !c.isRedeemed && (!c.expiredAt || new Date(c.expiredAt).getTime() > now.getTime())).length;
    await userClient.updateMembershipCounters({
      userId: input.userId,
      businessId: input.businessId,
      validStamps,
      validCoupons: unredeemedCount,
      totalStampsDelta: input.stamps,
      totalCouponsDelta: createdCoupon ? 1 : 0,
    });

    return reply.code(200).send({
      message: 'Stamps applied',
      data: {
        validStamps,
        createdCoupon: createdCoupon ? { id: createdCoupon.id, code: createdCoupon.code } : null,
      },
    });
  });
}
