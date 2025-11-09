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

    const nonPromotionalCoupons = coupons
      .filter((c: any) => c.prize && c.prize.isPromotional === false)
      .slice()
      .sort((a: any, b: any) => {
        const aTs = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt ?? 0).getTime();
        const bTs = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt ?? 0).getTime();
        return aTs - bTs;
      });

    let createdCoupon: any = null;
    let consumedStampsAfter = 0;

    if (nonPromotionalPrizes.length > 0) {
      const thresholds = nonPromotionalPrizes.map((p: any) => p.pointsRequired);
      const maxThreshold = thresholds[thresholds.length - 1];

      let currentCycle = 0;
      let lastStageIndex = -1;
      let absLastThreshold = 0;

      for (const coupon of nonPromotionalCoupons) {
        const stageIndex = thresholds.findIndex((value: number) => value === Number(coupon.prize?.pointsRequired ?? 0));
        if (stageIndex === -1) continue;
        if (lastStageIndex !== -1 && stageIndex <= lastStageIndex) {
          currentCycle += 1;
        }
        absLastThreshold = currentCycle * maxThreshold + thresholds[stageIndex];
        lastStageIndex = stageIndex;
      }

      const consumedStampsBefore = absLastThreshold;
      consumedStampsAfter = consumedStampsBefore;

      const nextStageIndex = lastStageIndex === -1 ? 0 : (lastStageIndex + 1) % thresholds.length;
      let cycleForNextStage = currentCycle;
      if (lastStageIndex !== -1 && nextStageIndex <= lastStageIndex) {
        cycleForNextStage += 1;
      }

      const targetPrize = nonPromotionalPrizes[nextStageIndex] ?? null;
      const absNextThreshold = targetPrize ? cycleForNextStage * maxThreshold + targetPrize.pointsRequired : 0;
      const stampsToConsume = targetPrize ? absNextThreshold - consumedStampsBefore : 0;

      if (targetPrize && stampsToConsume > 0 && validStamps >= absNextThreshold) {
        const code = crypto.randomUUID();
        createdCoupon = await app.repository.createCoupon(input.userId, input.businessId, targetPrize.id, code);
        coupons.push(createdCoupon);
        consumedStampsAfter = absNextThreshold;
      }
    } else {
      const numericThresholds = prizes
        .map((p: any) => Number(p.pointsRequired) || 0)
        .filter((value: number) => value > 0);
      const baseRequired = numericThresholds.length > 0 ? Math.min(...numericThresholds) : 15;
      const totalCoupons = coupons.length;
      const entitledCoupons = Math.floor(validStamps / baseRequired);
      const consumedBefore = Math.min(validStamps, totalCoupons * baseRequired);
      let consumedAfter = consumedBefore;

      if (entitledCoupons > totalCoupons) {
        const prize = prizes.find((p: any) => Number(p.pointsRequired) === baseRequired) || prizes[0] || null;
        if (prize) {
          const code = crypto.randomUUID();
          createdCoupon = await app.repository.createCoupon(input.userId, input.businessId, prize.id, code);
          coupons.push(createdCoupon);
          consumedAfter = Math.min(validStamps, (totalCoupons + 1) * baseRequired);
        }
      }

      consumedStampsAfter = consumedAfter;
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
    const adjustedValidStamps = Math.max(0, validStamps - consumedStampsAfter);

    await userClient.updateMembershipCounters({
      userId: input.userId,
      businessId: input.businessId,
      validStamps: adjustedValidStamps,
      validCoupons: unredeemedCount,
      totalStampsDelta: input.stamps,
      totalCouponsDelta: createdCoupon ? 1 : 0,
    });

    return reply.code(200).send({
      message: 'Stamps applied',
      data: {
        validStamps: adjustedValidStamps,
        createdCoupon: createdCoupon ? { id: createdCoupon.id, code: createdCoupon.code } : null,
      },
    });
  });
}
