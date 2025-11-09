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

    const normalizedPrizes = prizes
      .map((p: any) => ({ ...p, pointsRequired: Number(p.pointsRequired) || 0, isPromotional: !!p.isPromotional }))
      .filter((p: any) => p.pointsRequired > 0)
      .sort((a: any, b: any) => a.pointsRequired - b.pointsRequired);

    const preferredSequence = normalizedPrizes.filter((p: any) => !p.isPromotional);
    const prizeSequence = preferredSequence.length > 0 ? preferredSequence : normalizedPrizes;
    const prizeIndexById = new Map(prizeSequence.map((p: any, index: number) => [p.id, index]));
    const cycleSpan = prizeSequence.length > 0 ? prizeSequence[prizeSequence.length - 1].pointsRequired : 0;

    const eligibleCoupons = coupons
      .filter((c: any) => c.prize && prizeIndexById.has(c.prize.id))
      .slice()
      .sort((a: any, b: any) => {
        const aTs = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt ?? 0).getTime();
        const bTs = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt ?? 0).getTime();
        return aTs - bTs;
      });

    let currentCycle = 0;
    let lastStageIndex = -1;
    let consumedStampsBefore = 0;

    if (cycleSpan > 0) {
      for (const coupon of eligibleCoupons) {
        const stageIndex = prizeIndexById.get(coupon.prize.id);
        if (typeof stageIndex !== 'number') continue;
        if (lastStageIndex !== -1 && stageIndex <= lastStageIndex) {
          currentCycle += 1;
        }
        consumedStampsBefore = currentCycle * cycleSpan + prizeSequence[stageIndex].pointsRequired;
        lastStageIndex = stageIndex;
      }
    }

    let consumedStampsAfter = consumedStampsBefore;
    let createdCoupon: any = null;

    if (prizeSequence.length > 0 && cycleSpan > 0) {
      const nextStageIndex = lastStageIndex === -1 ? 0 : (lastStageIndex + 1) % prizeSequence.length;
      let cycleForNextStage = currentCycle;
      if (lastStageIndex !== -1 && nextStageIndex <= lastStageIndex) {
        cycleForNextStage += 1;
      }

      const targetPrize = prizeSequence[nextStageIndex];
      const absNextThreshold = cycleForNextStage * cycleSpan + targetPrize.pointsRequired;
      const stampsToConsume = absNextThreshold - consumedStampsBefore;

      if (absNextThreshold > 0 && stampsToConsume > 0 && validStamps >= absNextThreshold) {
        const code = crypto.randomUUID();
        createdCoupon = await app.repository.createCoupon(input.userId, input.businessId, targetPrize.id, code);
        coupons.push(createdCoupon);
        consumedStampsAfter = absNextThreshold;
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
  const adjustedValidStamps = Math.max(0, validStamps - Math.min(consumedStampsAfter, validStamps));

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
