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

  // --- Multi-location analytics (per-location dashboards) -------------------
  const parseDays = (q: any, def = 30, max = 365): number => {
    const n = Number(q?.days ?? def);
    return Math.min(max, Math.max(1, Number.isFinite(n) ? Math.trunc(n) : def));
  };
  const rangeFromDays = (days: number): { from: Date; to: Date } => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { from, to };
  };
  const startMidnightUTC = (days: number): Date => {
    const m = new Date();
    m.setUTCHours(0, 0, 0, 0);
    return new Date(m.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  };
  const locationRefs = (locations: any[]) => locations.map((l: any) => ({ id: l.id, name: l.name }));

  // Brand locations — powers the dashboard location switcher.
  app.get('/api/v1/analytics/locations', async (_request: any, reply: any) => {
    try {
      const locations = await app.repository.listBrandLocations();
      return reply.send({ message: 'ok', data: locationRefs(locations) });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch locations' });
    }
  });

  // Per-location headline metrics — KPI strip + comparison view.
  app.get('/api/v1/analytics/by-location', async (request: any, reply: any) => {
    try {
      const { from, to } = rangeFromDays(parseDays(request.query));
      const data = await app.repository.metricsByLocation(from, to);
      return reply.send({ message: 'ok', data });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch by-location analytics' });
    }
  });

  // Daily stamps per location — owner dashboard stacked chart.
  app.get('/api/v1/analytics/daily-by-location', async (request: any, reply: any) => {
    try {
      const days = parseDays(request.query);
      const [rows, locations] = await Promise.all([
        app.repository.dailyStampsByLocation(startMidnightUTC(days)),
        app.repository.listBrandLocations(),
      ]);
      return reply.send({ message: 'ok', data: { rows, locations: locationRefs(locations) } });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch daily-by-location analytics' });
    }
  });

  // New-customer acquisition per location (by first-stamp) — daily series.
  app.get('/api/v1/analytics/acquisition', async (request: any, reply: any) => {
    try {
      const days = parseDays(request.query);
      const [rows, locations] = await Promise.all([
        app.repository.acquisitionDailyByLocation(startMidnightUTC(days)),
        app.repository.listBrandLocations(),
      ]);
      return reply.send({ message: 'ok', data: { rows, locations: locationRefs(locations) } });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch acquisition analytics' });
    }
  });

  // Cross-location wallet flow — earned-at vs. redeemed-at matrix.
  app.get('/api/v1/analytics/cross-location', async (request: any, reply: any) => {
    try {
      const { from, to } = rangeFromDays(parseDays(request.query));
      const [matrix, locations] = await Promise.all([
        app.repository.crossLocationRedemptions(from, to),
        app.repository.listBrandLocations(),
      ]);
      return reply.send({ message: 'ok', data: { matrix, locations: locationRefs(locations) } });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch cross-location analytics' });
    }
  });

  // Per-location retention buckets (active / at-risk / lost).
  app.get('/api/v1/analytics/retention', async (request: any, reply: any) => {
    try {
      const days = parseDays(request.query);
      const [rows, locations] = await Promise.all([
        app.repository.retentionByLocation(days),
        app.repository.listBrandLocations(),
      ]);
      const nameMap = new Map<string, string>(locations.map((l: any) => [l.id, l.name]));
      const seen = new Set(rows.map((r: any) => r.businessId));
      const data = rows.map((r: any) => ({ ...r, name: nameMap.get(r.businessId) ?? r.businessId }));
      for (const l of locations) {
        if (!seen.has(l.id)) data.push({ businessId: l.id, name: l.name, total: 0, active: 0, atRisk: 0, lost: 0 });
      }
      return reply.send({ message: 'ok', data });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch retention analytics' });
    }
  });

  // Reward funnel per location (stamps -> earned -> redeemed -> expired).
  app.get('/api/v1/analytics/reward-funnel', async (request: any, reply: any) => {
    try {
      const { from, to } = rangeFromDays(parseDays(request.query));
      const data = await app.repository.rewardFunnel(from, to);
      return reply.send({ message: 'ok', data });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch reward-funnel analytics' });
    }
  });

  // Stamp activity heatmap by weekday x hour (Europe/Rome), optionally one location.
  app.get('/api/v1/analytics/stamp-heatmap', async (request: any, reply: any) => {
    try {
      const q = request.query || {};
      const businessId = typeof q.businessId === 'string' && q.businessId ? q.businessId : null;
      const { from, to } = rangeFromDays(parseDays(q));
      const data = await app.repository.stampHeatmap(from, to, businessId);
      return reply.send({ message: 'ok', data });
    } catch (e: any) {
      app.log.error(e);
      return reply.code(500).send({ message: 'Failed to fetch stamp-heatmap analytics' });
    }
  });
}
