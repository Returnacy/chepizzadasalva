import type { FastifyInstance } from 'fastify';
import { TokenService } from '../services/tokenService.js';
import { UserServiceClient } from '../services/userServiceClient.js';
import { callerIsBrandStaff } from '../authz/tenantAccess.js';

function serializeCoupon(coupon: any) {
  return {
    id: coupon.id,
    userId: coupon.userId,
    businessId: coupon.businessId,
    prizeId: coupon.prizeId,
    code: coupon.code,
    qrCode: coupon.code,
    isRedeemed: !!coupon.isRedeemed,
    createdAt: coupon.createdAt,
    expiredAt: coupon.expiredAt ?? null,
    redeemedAt: coupon.redeemedAt ?? null,
    prize: coupon.prize
      ? {
          id: coupon.prize.id,
          name: coupon.prize.name,
          pointsRequired: coupon.prize.pointsRequired,
        }
      : undefined,
  };
}

export function registerCouponsRoutes(app: FastifyInstance) {
  app.post('/api/v1/coupons', async (request: any, reply: any) => {
    /*Add check service*/
    const authPayload = (request as any).auth ?? {};
    const azp = typeof authPayload.azp === 'string' ? authPayload.azp : null;
    const audClaim = authPayload.aud;
    const audList = Array.isArray(audClaim)
      ? audClaim
      : typeof audClaim === 'string'
        ? [audClaim]
        : [];
    const isCampaignService = (azp && azp === 'campaign-service') || audList.some((aud: any) => String(aud) === 'campaign-service');
    if (!isCampaignService) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Coupon creation allowed only for campaign-service' });
    }
    const { userId, businessId, prizeId, code } = request.body as { userId: string; businessId: string; prizeId: string; code: string };
    const coupon = await app.repository.createCoupon(userId, businessId, prizeId, code, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    return { coupon: serializeCoupon(coupon) };
  });

  app.patch('/api/v1/coupons/:id/redeem', async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const body = (request.body as any) ?? {};
    // Optional: location where the coupon is being redeemed (may differ from where
    // it was earned under a shared brand wallet). Best-effort attribution.
    const redeemedBusinessId = body.businessId ? String(body.businessId) : null;
    // Manager override: honor an expired coupon despite the block (goodwill).
    const override = body.override === true;

    // Integrity gate: a coupon must exist, be unredeemed, and unexpired (unless
    // overridden). Previously redeem updated by id blindly, which let the staff
    // scanner's no-expiry shortcut redeem long-expired coupons.
    const existing = await app.repository.getCouponById(id);
    if (!existing) {
      return reply.code(404).send({ error: 'COUPON_NOT_FOUND', message: 'Coupon not found' });
    }
    if (existing.isRedeemed) {
      return reply.code(409).send({ error: 'ALREADY_REDEEMED', message: 'Coupon already redeemed' });
    }
    const isExpired = !!existing.expiredAt && new Date(existing.expiredAt).getTime() < Date.now();
    if (isExpired && !override) {
      return reply.code(409).send({ error: 'COUPON_EXPIRED', message: 'Coupon expired', expiredAt: existing.expiredAt });
    }
    if (isExpired && override) {
      app.log.warn(
        { couponId: id, code: existing.code, expiredAt: existing.expiredAt, redeemedBusinessId },
        '[business-service] expired coupon redeemed via manager override',
      );
    }

    const coupon = await app.repository.redeemCoupon(id, redeemedBusinessId);

    try {
      const tokenService = TokenService.fromEnv();
      const userClient = new UserServiceClient({ baseUrl: process.env.USER_SERVICE_URL || 'http://user-server:3000', tokenService });
      const now = new Date();
      const remaining = (await app.repository.listCoupons(coupon.userId, coupon.businessId)).filter(
        (c: any) => !c.isRedeemed && (!c.expiredAt || new Date(c.expiredAt).getTime() > now.getTime())
      ).length;
      await userClient.updateMembershipCounters({
        userId: coupon.userId,
        businessId: coupon.businessId,
        brandId: app.repository.brandId,
        scope: await app.repository.getWalletScope(),
        validCoupons: remaining,
      });
    } catch (err) {
      app.log.error({ err, couponId: id }, '[business-service] failed to sync coupon counters after redeem');
    }

    return { coupon: serializeCoupon(coupon) };
  });

  // allowUserAccess: customers read their own loyalty card here (customer.tsx
  // → legacy-api-adapter.getUserCoupons). They only ever reached it because
  // every user token slipped through the global gate's service branch; now that
  // the branch is closed the route has to grant it explicitly, or the card
  // silently empties for every customer.
  app.get('/api/v1/coupons', {
    config: { allowUserAccess: true },
    handler: async (request: any, reply: any) => {
      const { businessId, code } = request.query as { businessId?: string; code?: string };
      let userId = (request.query as { userId?: string }).userId;
      if (!businessId) {
        return reply.code(400).send({ message: 'businessId required' });
      }

      // Staff may ask about anyone in the brand; a customer only about
      // themselves. Opening this route to customers without that would swap a
      // cross-tenant hole for an in-tenant one.
      const isStaff = callerIsBrandStaff(
        request.userMemberships ?? [],
        app.repository.brandId,
        await app.repository.getBrandBusinessIds().catch(() => [] as string[]),
      );
      if (!isStaff) {
        const self = request.selfUserId;
        // Lookup-by-code is the counter scanner's flow, not a customer's.
        if (!self || code) return reply.code(403).send({ error: 'FORBIDDEN' });
        if (userId && String(userId) !== String(self)) {
          return reply.code(403).send({ error: 'FORBIDDEN' });
        }
        userId = self;
      }

      if (code) {
        const trimmedCode = String(code).trim();
        if (!trimmedCode) {
          return reply.code(400).send({ message: 'code required' });
        }
        const coupon = await app.repository.findCouponByCode(trimmedCode, businessId);
        if (!coupon) {
          return reply.code(404).send({ message: 'Coupon not found' });
        }
        return { coupons: [serializeCoupon(coupon)] };
      }

      if (!userId) {
        return reply.code(400).send({ message: 'userId required' });
      }

      const coupons = await app.repository.listCoupons(String(userId), businessId);
      return { coupons: coupons.map(serializeCoupon) };
    },
  });
}
