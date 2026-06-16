import type { FastifyInstance } from 'fastify';
import { TokenService } from '../services/tokenService.js';
import { UserServiceClient } from '../services/userServiceClient.js';

export function registerAnalyticsRoutes(app: FastifyInstance) {
  // GET /api/v1/analytics - core metrics
  app.get('/api/v1/analytics', async (request: any, reply: any) => {
    try {
      // Scope: brand-wide aggregate by default under a BRAND wallet, single
      // location otherwise; `?businessId=` forces a per-location drill-down.
      const scope = await app.repository.getWalletScope();
      const brandId = app.repository.brandId;
      const q = request.query || {};
      const filterBusinessId = typeof q.businessId === 'string' && q.businessId ? q.businessId : null;
      const bizSet: string | string[] = filterBusinessId
        ? filterBusinessId
        : (scope === 'BRAND' ? await app.repository.getBrandBusinessIds() : app.repository.businessId);
      const userScope = filterBusinessId
        ? { businessId: filterBusinessId }
        : (scope === 'BRAND' ? { brandId } : { businessId: app.repository.businessId });

      // Basic metrics using business-service data we own (stamps/coupons)
      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - 7);
      const startOfMonth = new Date(now);
      startOfMonth.setDate(now.getDate() - 30);

      // Total customers from user-service: count users with membership in scope
      const userServiceUrl = process.env.USER_SERVICE_URL || 'https://user.returnacy.app';
      const tokenService = TokenService.fromEnv();
      const userClient = new UserServiceClient({ baseUrl: userServiceUrl, tokenService });
      const totalCustomers = await userClient.countUsers(userScope);

      const [weekTotalStamps, monthTotalStamps, monthTotalCouponsRedeemed, weekNewUsers, totalCouponsRedeemed, weekTotalCouponsRedeemed, averageUserFrequency, returnacyRate] = await Promise.all([
        app.repository.countStampsInRange(bizSet, startOfWeek, now),
        app.repository.countStampsInRange(bizSet, startOfMonth, now),
        app.repository.countRedeemedCouponsInRange(bizSet, startOfMonth, now),
        userClient.countNewUsers(userScope, startOfWeek),
        app.repository.countTotalCouponsRedeemed(bizSet),
        app.repository.countRedeemedCouponsInRange(bizSet, startOfWeek, now),
        app.repository.calculateAverageUserFrequency(bizSet, 30),
        app.repository.calculateReturnacyRate(bizSet, 30),
      ]);

      const payload = {
        totalUsers: totalCustomers,
        returnacyRate, // count of returning users; frontend maps to percentage
        totalCouponsRedeemed,
        weekTotalCouponsRedeemed,
        weekTotalStamps,
        weekNewUsers,
        monthTotalStamps,
        monthTotalCouponsRedeemed,
        averageUserFrequency,
      };

      return reply.send({ message: 'ok', data: payload });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch analytics' });
    }
  });

  // GET /api/v1/analytics/daily-transactions?days=N
  app.get('/api/v1/analytics/daily-transactions', async (request: any, reply: any) => {
    try {
      const scope = await app.repository.getWalletScope();
      const q = request.query || {};
      const filterBusinessId = typeof q.businessId === 'string' && q.businessId ? q.businessId : null;
      const bizSet: string | string[] = filterBusinessId
        ? filterBusinessId
        : (scope === 'BRAND' ? await app.repository.getBrandBusinessIds() : app.repository.businessId);

      const days = Math.min(90, Math.max(1, Number(q.days || 30)));

      // Align to UTC midnight and compute start date (inclusive)
      const now = new Date();
      const currentMidnight = new Date(now);
      currentMidnight.setHours(0, 0, 0, 0);
      const startDate = new Date(currentMidnight.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

      const [dailyTransactions, dailyStamps] = await Promise.all([
        app.repository.getDailyTransactionsSessions(bizSet, startDate, currentMidnight),
        app.repository.getDailyStamps(bizSet, startDate, currentMidnight),
      ]);

      return reply.send({ message: 'ok', data: { dailyTransactions, dailyStamps } });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch daily transactions' });
    }
  });
}
