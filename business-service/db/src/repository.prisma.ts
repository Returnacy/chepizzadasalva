import { prisma } from './prismaClient.js';

type WalletScope = 'LOCATION' | 'BRAND';

export class RepositoryPrisma {
  brandId: string;
  businessId: string;
  private _walletScope: WalletScope | null = null;
  private _brandBusinessIds: string[] | null = null;

  constructor() {
    const env = ((globalThis as any)?.process?.env ?? {}) as Record<string, string | undefined>;
    this.brandId = env.DEFAULT_BRAND_ID ?? '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47';
    this.businessId = env.DEFAULT_BUSINESS_ID ?? 'af941888-ec4c-458e-b905-21673241af3e';
  }

  // --- Wallet scope -----------------------------------------------------------
  // A brand's wallet is either per-location (LOCATION, default) or shared across
  // all its locations (BRAND). Reads that compute a customer's balance/progression
  // span the brand's businesses under BRAND scope, and stay per-location otherwise.
  // Cached per repository instance (a singleton); changes take effect on restart,
  // which is fine since wallet scope and the set of locations change rarely.
  async getWalletScope(): Promise<WalletScope> {
    if (this._walletScope) return this._walletScope;
    const brand = await prisma.brand.findUnique({ where: { id: this.brandId }, select: { walletScope: true } });
    this._walletScope = ((brand?.walletScope as WalletScope) ?? 'LOCATION');
    return this._walletScope;
  }

  async getBrandBusinessIds(): Promise<string[]> {
    if (this._brandBusinessIds) return this._brandBusinessIds;
    const rows = await prisma.business.findMany({ where: { brandId: this.brandId }, select: { id: true } });
    this._brandBusinessIds = rows.map(r => r.id);
    return this._brandBusinessIds;
  }

  async isBusinessInBrand(businessId: string): Promise<boolean> {
    return (await this.getBrandBusinessIds()).includes(businessId);
  }

  // Locations of the brand, for the staff "which location today" picker.
  async listBrandLocations() {
    return prisma.business.findMany({
      where: { brandId: this.brandId },
      select: { id: true, name: true, address: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Prisma `businessId` filter honoring wallet scope: the whole brand under BRAND,
  // the single passed location under LOCATION.
  private async walletBusinessFilter(businessId: string): Promise<string | { in: string[] }> {
    const scope = await this.getWalletScope();
    if (scope === 'BRAND') return { in: await this.getBrandBusinessIds() };
    return businessId;
  }

  // Prizes
  async listPrizes() {
    return prisma.prize.findMany({ where: { businessId: this.businessId, brandId: this.brandId } });
  }
  async listNonPromotionalPrizes() {
    return prisma.prize.findMany({
      where: {
        businessId: this.businessId,
        brandId: this.brandId,
        isPromotional: false,
      },
      orderBy: { pointsRequired: 'asc' },
    });
  }
  async createPrize(p: { name: string; pointsRequired: number; isPromotional?: boolean; businessId?: string | null; brandId?: string | null }) {
    return prisma.prize.create({ data: { ...p, isPromotional: p.isPromotional ?? false } });
  }
  async getLastNonPromotionalPrize(userId: string) {
    const lastNonPromotionalCoupon = await this.getLastNonPromotionalCoupon(userId);
    if (!lastNonPromotionalCoupon) return null;
    return lastNonPromotionalCoupon.prize;
  }
  async getNextNonPromotionalPrize(userId: string) {
    const lastNonPromotionalPrize = await this.getLastNonPromotionalPrize(userId);
    if (!lastNonPromotionalPrize) {
      return prisma.prize.findFirst({
        where: {
          OR: [
            { businessId: this.businessId },
            { brandId: this.brandId },
          ],
          isPromotional: false,
        },
        orderBy: { pointsRequired: 'asc' },
      });
    }
    const nextNonPromotionalPrize = await prisma.prize.findFirst({
      where: {
        OR: [
            { businessId: this.businessId },
            { brandId: this.brandId },
          ],
        isPromotional: false,
        pointsRequired: { gt: lastNonPromotionalPrize?.pointsRequired ?? 0 },
      },
      orderBy: { pointsRequired: 'asc' },
    });
    if (!nextNonPromotionalPrize) return await prisma.prize.findFirst({
      where: {
        OR: [
            { businessId: this.businessId },
            { brandId: this.brandId },
          ],
        isPromotional: false,
      },
      orderBy: { pointsRequired: 'asc' },
    });
    return nextNonPromotionalPrize;
  }


  // Stamps
  async addStamp(userId: string, businessId: string) {
    // Attribute the stamp to the location it was earned at (the caller-supplied
    // businessId), not the repository default — this is what makes per-location
    // data real while the brand wallet still aggregates across locations.
    return prisma.stamp.create({ data: { userId, businessId } });
  }
  async listStamps(userId: string, businessId: string, filter?: { isRedeemed?: boolean }) {
    const where: any = { userId, businessId: await this.walletBusinessFilter(businessId) };
    if (filter?.isRedeemed !== undefined) {
      where.isRedeemed = filter.isRedeemed;
    }
    return prisma.stamp.findMany({ where, orderBy: { createdAt: 'asc' } });
  }
  async redeemStamp(stampId: string) {
    return prisma.stamp.update({ where: { id: stampId }, data: { isRedeemed: true } });
  }
  async countValidStamps(userId: string, businessId: string) {
    return prisma.stamp.count({ where: { userId, businessId: await this.walletBusinessFilter(businessId), isRedeemed: false } });
  }

  // Coupons
  async createCoupon(userId: string, businessId: string, prizeId: string, code: string, expiredAt?: Date | null) {
    const defaultExpiry = expiredAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return prisma.coupon.create({ data: { userId, businessId, prizeId, code, expiredAt: defaultExpiry }, include: { prize: true } });
  }
  async getCouponById(couponId: string) {
    return prisma.coupon.findUnique({ where: { id: couponId }, include: { prize: true } });
  }
  async findCouponByCode(code: string, businessId: string) {
    // Code is globally unique; scoping by the wallet filter lets a BRAND-scoped
    // coupon be found (and redeemed) at any of the brand's locations, while
    // LOCATION scope keeps redemption to the issuing location.
    return prisma.coupon.findFirst({ where: { code, businessId: await this.walletBusinessFilter(businessId) }, include: { prize: true } });
  }
  async redeemCoupon(couponId: string, redeemedBusinessId?: string | null) {
    return prisma.coupon.update({
      where: { id: couponId },
      data: { isRedeemed: true, redeemedAt: new Date(), redeemedBusinessId: redeemedBusinessId ?? undefined },
      include: { prize: true },
    });
  }
  async listCoupons(userId: string, businessId: string) {
    return prisma.coupon.findMany({ where: { userId, businessId: await this.walletBusinessFilter(businessId) }, include: { prize: true } });
  }
  async listNonPromotionalCoupons(userId: string, businessId: string) {
    return prisma.coupon.findMany({
      where: {
        userId,
        businessId: await this.walletBusinessFilter(businessId),
        prize: { isPromotional: false },
      },
      include: { prize: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getLastNonPromotionalCoupon(userId: string) {
    return prisma.coupon.findFirst({
      where: {
        userId,
        businessId: await this.walletBusinessFilter(this.businessId),
        prize: { isPromotional: false },
      },
      include: { prize: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Capacity (available messages)
  async getBusinessCapacity(businessId: string) {
    const biz = await prisma.business.findUnique({ where: { id: businessId } });
    if (!biz) return null;
    return {
      email: biz.availableEmail,
      sms: biz.availableSms,
      push: biz.availablePush,
    };
  }

  // Analytics helpers
  // `businessId` accepts a single location id or an array (brand-wide aggregate
  // with optional per-location drill-down). `bizWhere` normalises it for Prisma.
  private bizWhere(businessId: string | string[]) {
    return Array.isArray(businessId) ? { in: businessId } : businessId;
  }
  private bizArray(businessId: string | string[]): string[] {
    return Array.isArray(businessId) ? businessId : [businessId];
  }

  async countStampsInRange(businessId: string | string[], from: Date, to: Date) {
    return prisma.stamp.count({ where: { businessId: this.bizWhere(businessId), createdAt: { gte: from, lt: to } } });
  }

  async countRedeemedCouponsInRange(businessId: string | string[], from: Date, to: Date) {
    return prisma.coupon.count({ where: { businessId: this.bizWhere(businessId), isRedeemed: true, redeemedAt: { gte: from, lt: to } } });
  }

  async countTotalCouponsRedeemed(businessId: string | string[]) {
    return prisma.coupon.count({ where: { businessId: this.bizWhere(businessId), isRedeemed: true } });
  }

  async distinctUsersForBusiness(businessId: string | string[]) {
  const rows: Array<{ userId: string }> = await prisma.stamp.findMany({ where: { businessId: this.bizWhere(businessId) }, select: { userId: true }, distinct: ['userId'] });
  const coup: Array<{ userId: string }> = await prisma.coupon.findMany({ where: { businessId: this.bizWhere(businessId) }, select: { userId: true }, distinct: ['userId'] });
  const set = new Set<string>();
  rows.forEach((r: { userId: string }) => set.add(r.userId));
  coup.forEach((r: { userId: string }) => set.add(r.userId));
    return set.size;
  }

  async countNewUsersSince(businessId: string | string[], since: Date) {
    // Approximation: count distinct users who got any stamp since the date
    const rows: Array<{ userId: string }> = await prisma.stamp.findMany({
      where: { businessId: this.bizWhere(businessId), createdAt: { gte: since } },
      select: { userId: true },
      distinct: ['userId']
    });
    return rows.length;
  }

  // Daily analytics (UTC-based)
  private getDateRange(startDate: Date, endDate: Date): Date[] {
    const dates: Date[] = [];
    const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(new Date(d));
    }
    return dates;
  }

  async getDailyStamps(businessId: string | string[], startDate: Date, endDate: Date = new Date()) {
    const ids = this.bizArray(businessId);
    // Group stamps per UTC date between startDate..endDate inclusive
    const result: Array<{ date: string; count: number }> = await prisma.$queryRaw`\
      SELECT TO_CHAR(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,\
             COUNT(*)::int AS count\
      FROM "Stamp"\
      WHERE "businessId" = ANY(${ids})\
        AND "createdAt" >= ${startDate}\
        AND "createdAt" < ${new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() + 1))}\
      GROUP BY 1\
      ORDER BY 1\
    `;
    const map = new Map(result.map(r => [r.date, Number(r.count)]));
    const days = this.getDateRange(startDate, endDate);
    return days.map(d => map.get(d.toISOString().slice(0, 10)) || 0);
  }

  async getDailyTransactionsSessions(businessId: string | string[], startDate: Date, endDate: Date = new Date()) {
    const ids = this.bizArray(businessId);
    // Count "sessions" per user per day (>=10 minutes gap starts a new session)
    const endExclusive = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate() + 1));
    const result: Array<{ date: string; count: number }> = await prisma.$queryRaw`\
      WITH stamps AS (\
        SELECT\
          ("createdAt" AT TIME ZONE 'UTC')              AS created_at_utc,\
          ("createdAt" AT TIME ZONE 'UTC')::date        AS day_utc,\
          "userId"\
        FROM "Stamp"\
        WHERE "businessId" = ANY(${ids})\
          AND "userId" IS NOT NULL\
          AND "createdAt" >= ${startDate}\
          AND "createdAt" < ${endExclusive}\
      ), gaps AS (\
        SELECT\
          day_utc,\
          "userId",\
          created_at_utc,\
          CASE\
            WHEN LAG(created_at_utc) OVER (PARTITION BY day_utc, "userId" ORDER BY created_at_utc) IS NULL THEN 1\
            WHEN EXTRACT(EPOCH FROM (created_at_utc - LAG(created_at_utc) OVER (PARTITION BY day_utc, "userId" ORDER BY created_at_utc))) >= 600 THEN 1\
            ELSE 0\
          END AS session_increment\
        FROM stamps\
      )\
      SELECT TO_CHAR(day_utc, 'YYYY-MM-DD') AS date,\
             SUM(session_increment)::int     AS count\
      FROM gaps\
      GROUP BY day_utc\
      ORDER BY day_utc\
    `;
    const map = new Map(result.map(r => [r.date, Number(r.count)]));
    const days = this.getDateRange(startDate, endDate);
    return days.map(d => map.get(d.toISOString().slice(0, 10)) || 0);
  }

  // Advanced metrics inspired by brand backend
  async calculateReturnacyRate(businessId: string | string[], days: number = 30) {
    const ids = this.bizArray(businessId);
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
    const prevWindowStart = new Date(since.getTime() - 1000 * 60 * 60 * 24 * 30);
    const rows: Array<{ c: number }> = await prisma.$queryRaw`\
      WITH purchases AS (\
        SELECT DISTINCT "userId", date_trunc('second', "createdAt") AS ts\
        FROM "Stamp"\
        WHERE "businessId" = ANY(${ids})\
          AND "createdAt" >= ${prevWindowStart}\
      )\
      SELECT COUNT(DISTINCT a."userId")::int AS c\
      FROM purchases a\
      JOIN purchases b\
        ON b."userId" = a."userId"\
       AND b.ts < a.ts\
       AND b.ts >= a.ts - INTERVAL '30 days'\
      WHERE a.ts >= ${since}\
    `;
    return rows[0]?.c ?? 0;
  }

  async calculateAverageUserFrequency(businessId: string | string[], days: number = 30) {
    const ids = this.bizArray(businessId);
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * days);
    const result: Array<{ avg_days: number | null }> = await prisma.$queryRaw`\
      WITH recent_stamps AS (\
        SELECT "userId", DATE("createdAt") AS day\
        FROM "Stamp"\
        WHERE "businessId" = ANY(${ids})\
          AND "createdAt" >= ${since}\
        GROUP BY "userId", DATE("createdAt")\
      ),\
      eligible_users AS (\
        SELECT "userId"\
        FROM recent_stamps\
        GROUP BY "userId"\
        HAVING COUNT(*) >= 2\
      ),\
      user_days AS (\
        SELECT rs."userId", rs.day\
        FROM recent_stamps rs\
        JOIN eligible_users eu ON eu."userId" = rs."userId"\
      ),\
      user_day_diffs AS (\
        SELECT "userId",\
               (day - LAG(day) OVER (PARTITION BY "userId" ORDER BY day))::int AS diff_days\
        FROM user_days\
      ),\
      per_user_avg AS (\
        SELECT "userId", AVG(diff_days)::float AS avg_days\
        FROM user_day_diffs\
        WHERE diff_days IS NOT NULL\
        GROUP BY "userId"\
      )\
      SELECT AVG(avg_days)::float AS avg_days\
      FROM per_user_avg\
    `;
    const avgDays = result[0]?.avg_days ?? 0;
    return Math.round(avgDays);
  }

  // CRM Users list - this relies on an external user-service normally. For now, return an empty list placeholder.
  // Extend later if a local mirror exists. Here we only provide stamp/coupon counts enrichment API.
  async getUsersStatsForBusiness(userIds: string[], businessId: string | string[]) {
    const bizFilter = this.bizWhere(businessId);
    const normalizedIds = Array.from(
      new Set(
        userIds
          .map(id => (id ?? '').toString().trim())
          .filter(id => id.length > 0)
      )
    );

    const stats = new Map<string, { totalStamps: number; validStamps: number; couponsCount: number; totalCoupons: number; lastVisit: Date | null }>();
    if (normalizedIds.length === 0) {
      return stats;
    }

    normalizedIds.forEach(id => {
      stats.set(id, { totalStamps: 0, validStamps: 0, couponsCount: 0, totalCoupons: 0, lastVisit: null });
    });

    const now = new Date();

    const [stampTotals, validStampTotals, couponTotals, activeCoupons] = await Promise.all([
      prisma.stamp.groupBy({
        by: ['userId'],
        where: { businessId: bizFilter, userId: { in: normalizedIds } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.stamp.groupBy({
        by: ['userId'],
        where: { businessId: bizFilter, userId: { in: normalizedIds }, isRedeemed: false },
        _count: { _all: true },
      }),
      prisma.coupon.groupBy({
        by: ['userId'],
        where: { businessId: bizFilter, userId: { in: normalizedIds } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.coupon.groupBy({
        by: ['userId'],
        where: {
          businessId: bizFilter,
          userId: { in: normalizedIds },
          isRedeemed: false,
          OR: [
            { expiredAt: null },
            { expiredAt: { gt: now } },
          ],
        },
        _count: { _all: true },
      }),
    ]);

    for (const row of stampTotals) {
      const entry = stats.get(row.userId);
      if (!entry) continue;
      entry.totalStamps = row._count?._all ?? 0;
      const createdAt = row._max?.createdAt ?? null;
      if (createdAt && (!entry.lastVisit || createdAt > entry.lastVisit)) {
        entry.lastVisit = createdAt;
      }
    }

    for (const row of validStampTotals) {
      const entry = stats.get(row.userId);
      if (!entry) continue;
      entry.validStamps = row._count?._all ?? 0;
    }

    for (const row of couponTotals) {
      const entry = stats.get(row.userId);
      if (!entry) continue;
      entry.totalCoupons = row._count?._all ?? 0;
      const createdAt = row._max?.createdAt ?? null;
      if (createdAt && (!entry.lastVisit || createdAt > entry.lastVisit)) {
        entry.lastVisit = createdAt;
      }
    }

    for (const row of activeCoupons) {
      const entry = stats.get(row.userId);
      if (!entry) continue;
      entry.couponsCount = row._count?._all ?? 0;
    }

    return stats;
  }

  async getUserStatsForBusiness(userId: string, businessId: string) {
    const stats = await this.getUsersStatsForBusiness([userId], businessId);
    return stats.get((userId ?? '').toString().trim()) ?? {
      totalStamps: 0,
      validStamps: 0,
      couponsCount: 0,
      totalCoupons: 0,
      lastVisit: null,
    };
  }

  // ===========================================================================
  // Multi-location analytics (read-only; powers the per-location dashboards).
  // Everything below queries only the brand's existing locations and existing
  // columns — no schema changes. Ranges are half-open [from, to).
  // ===========================================================================

  // Stamps created in range, grouped by location.
  async stampsByLocation(from: Date, to: Date): Promise<Map<string, number>> {
    const ids = await this.getBrandBusinessIds();
    const rows = await prisma.stamp.groupBy({
      by: ['businessId'],
      where: { businessId: { in: ids }, createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return new Map(rows.map((r): [string, number] => [r.businessId, r._count?._all ?? 0]));
  }

  // Coupons redeemed in range, grouped by the location they were earned at.
  async redeemedCouponsByLocation(from: Date, to: Date): Promise<Map<string, number>> {
    const ids = await this.getBrandBusinessIds();
    const rows = await prisma.coupon.groupBy({
      by: ['businessId'],
      where: { businessId: { in: ids }, isRedeemed: true, redeemedAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return new Map(rows.map((r): [string, number] => [r.businessId, r._count?._all ?? 0]));
  }

  // Distinct customers who got at least one stamp in range, grouped by location.
  async activeCustomersByLocation(from: Date, to: Date): Promise<Map<string, number>> {
    const ids = await this.getBrandBusinessIds();
    const rows: Array<{ businessId: string; count: number }> = await prisma.$queryRaw`
      SELECT "businessId", COUNT(DISTINCT "userId")::int AS count
      FROM "Stamp"
      WHERE "businessId" = ANY(${ids}) AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "businessId"
    `;
    return new Map(rows.map((r): [string, number] => [r.businessId, Number(r.count)]));
  }

  // New customers acquired in range, attributed to the location of their FIRST
  // ever stamp. This is the honest per-location acquisition signal: customer
  // registration carries a single shared host id, but the first stamp records
  // the physical pizzeria that brought the customer in.
  async firstStampAcquisitionByLocation(from: Date, to: Date): Promise<Map<string, number>> {
    const ids = await this.getBrandBusinessIds();
    const rows: Array<{ businessId: string; count: number }> = await prisma.$queryRaw`
      WITH firsts AS (
        SELECT "userId",
               (ARRAY_AGG("businessId" ORDER BY "createdAt" ASC))[1] AS first_business,
               MIN("createdAt") AS first_at
        FROM "Stamp"
        WHERE "userId" IS NOT NULL AND "businessId" = ANY(${ids})
        GROUP BY "userId"
      )
      SELECT first_business AS "businessId", COUNT(*)::int AS count
      FROM firsts
      WHERE first_at >= ${from} AND first_at < ${to}
      GROUP BY first_business
    `;
    return new Map(rows.map((r): [string, number] => [r.businessId, Number(r.count)]));
  }

  // Headline per-location metrics for the comparison view and the KPI strip.
  // Includes every brand location (zero-filled when no activity).
  async metricsByLocation(from: Date, to: Date) {
    const [locations, stamps, redeemed, acquired, active] = await Promise.all([
      this.listBrandLocations(),
      this.stampsByLocation(from, to),
      this.redeemedCouponsByLocation(from, to),
      this.firstStampAcquisitionByLocation(from, to),
      this.activeCustomersByLocation(from, to),
    ]);
    return locations.map(l => ({
      businessId: l.id,
      name: l.name,
      stamps: stamps.get(l.id) ?? 0,
      couponsRedeemed: redeemed.get(l.id) ?? 0,
      newCustomers: acquired.get(l.id) ?? 0,
      activeCustomers: active.get(l.id) ?? 0,
    }));
  }

  // Daily stamp counts per location since startDate (UTC days), for the
  // per-location stacked chart on the owner dashboard.
  async dailyStampsByLocation(startDate: Date): Promise<Array<{ date: string; businessId: string; count: number }>> {
    const ids = await this.getBrandBusinessIds();
    const rows: Array<{ date: string; businessId: string; count: number }> = await prisma.$queryRaw`
      SELECT TO_CHAR(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
             "businessId", COUNT(*)::int AS count
      FROM "Stamp"
      WHERE "businessId" = ANY(${ids}) AND "createdAt" >= ${startDate}
      GROUP BY 1, 2
      ORDER BY 1
    `;
    return rows.map(r => ({ date: r.date, businessId: r.businessId, count: Number(r.count) }));
  }

  // Daily new-customer acquisition per location (by first-stamp date) since
  // startDate, for the acquisition chart.
  async acquisitionDailyByLocation(startDate: Date): Promise<Array<{ date: string; businessId: string; count: number }>> {
    const ids = await this.getBrandBusinessIds();
    const rows: Array<{ date: string; businessId: string; count: number }> = await prisma.$queryRaw`
      WITH firsts AS (
        SELECT "userId",
               (ARRAY_AGG("businessId" ORDER BY "createdAt" ASC))[1] AS first_business,
               MIN("createdAt") AS first_at
        FROM "Stamp"
        WHERE "userId" IS NOT NULL AND "businessId" = ANY(${ids})
        GROUP BY "userId"
      )
      SELECT TO_CHAR((first_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
             first_business AS "businessId", COUNT(*)::int AS count
      FROM firsts
      WHERE first_at >= ${startDate}
      GROUP BY 1, 2
      ORDER BY 1
    `;
    return rows.map(r => ({ date: r.date, businessId: r.businessId, count: Number(r.count) }));
  }

  // Cross-location wallet flow: coupons redeemed in range, grouped by where they
  // were earned vs. where they were redeemed. Older redemptions predate the
  // redeemedBusinessId column, so they fall back to the earning location.
  async crossLocationRedemptions(from: Date, to: Date): Promise<Array<{ earnedBusinessId: string; redeemedBusinessId: string; count: number }>> {
    const ids = await this.getBrandBusinessIds();
    const rows: Array<{ earned: string; redeemed: string; count: number }> = await prisma.$queryRaw`
      SELECT "businessId" AS earned,
             COALESCE("redeemedBusinessId", "businessId") AS redeemed,
             COUNT(*)::int AS count
      FROM "Coupon"
      WHERE "isRedeemed" = true AND "redeemedAt" >= ${from} AND "redeemedAt" < ${to}
        AND "businessId" = ANY(${ids})
      GROUP BY 1, 2
    `;
    return rows.map(r => ({ earnedBusinessId: r.earned, redeemedBusinessId: r.redeemed, count: Number(r.count) }));
  }

  // Per-location retention buckets by each customer's most recent stamp at that
  // location: active (<= days), at-risk (days..2*days), lost (> 2*days).
  async retentionByLocation(days: number = 30): Promise<Array<{ businessId: string; total: number; active: number; atRisk: number; lost: number }>> {
    const ids = await this.getBrandBusinessIds();
    const activeSince = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const riskSince = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);
    const rows: Array<{ businessId: string; total: number; active: number; at_risk: number; lost: number }> = await prisma.$queryRaw`
      WITH last_per AS (
        SELECT "userId", "businessId", MAX("createdAt") AS last_at
        FROM "Stamp"
        WHERE "businessId" = ANY(${ids})
        GROUP BY "userId", "businessId"
      )
      SELECT "businessId",
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE last_at >= ${activeSince})::int AS active,
             COUNT(*) FILTER (WHERE last_at < ${activeSince} AND last_at >= ${riskSince})::int AS at_risk,
             COUNT(*) FILTER (WHERE last_at < ${riskSince})::int AS lost
      FROM last_per
      GROUP BY "businessId"
    `;
    return rows.map(r => ({ businessId: r.businessId, total: Number(r.total), active: Number(r.active), atRisk: Number(r.at_risk), lost: Number(r.lost) }));
  }

  // Reward funnel per location: stamps issued -> coupons earned -> redeemed,
  // plus coupons that expired unredeemed, all within range.
  async rewardFunnel(from: Date, to: Date) {
    const ids = await this.getBrandBusinessIds();
    const couponRows: Array<{ businessId: string; earned: number; redeemed: number; expired: number }> = await prisma.$queryRaw`
      SELECT "businessId",
             COUNT(*) FILTER (WHERE "createdAt" >= ${from} AND "createdAt" < ${to})::int AS earned,
             COUNT(*) FILTER (WHERE "isRedeemed" = true AND "redeemedAt" >= ${from} AND "redeemedAt" < ${to})::int AS redeemed,
             COUNT(*) FILTER (WHERE "isRedeemed" = false AND "expiredAt" IS NOT NULL AND "expiredAt" >= ${from} AND "expiredAt" < ${to})::int AS expired
      FROM "Coupon"
      WHERE "businessId" = ANY(${ids})
      GROUP BY "businessId"
    `;
    const couponMap = new Map(couponRows.map((c): [string, typeof c] => [c.businessId, c]));
    const [locations, stamps] = await Promise.all([
      this.listBrandLocations(),
      this.stampsByLocation(from, to),
    ]);
    return locations.map(l => {
      const c = couponMap.get(l.id);
      return {
        businessId: l.id,
        name: l.name,
        stamps: stamps.get(l.id) ?? 0,
        earned: Number(c?.earned ?? 0),
        redeemed: Number(c?.redeemed ?? 0),
        expired: Number(c?.expired ?? 0),
      };
    });
  }

  // Stamp activity by weekday (ISO 1=Mon..7=Sun) and hour, in Europe/Rome local
  // time so the heatmap reflects real opening hours. Optionally one location.
  async stampHeatmap(from: Date, to: Date, businessId?: string | null): Promise<Array<{ dow: number; hour: number; count: number }>> {
    const ids = businessId ? [businessId] : await this.getBrandBusinessIds();
    const rows: Array<{ dow: number; hour: number; count: number }> = await prisma.$queryRaw`
      SELECT EXTRACT(ISODOW FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome'))::int AS dow,
             EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome'))::int AS hour,
             COUNT(*)::int AS count
      FROM "Stamp"
      WHERE "businessId" = ANY(${ids}) AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1, 2
    `;
    return rows.map(r => ({ dow: Number(r.dow), hour: Number(r.hour), count: Number(r.count) }));
  }
}
