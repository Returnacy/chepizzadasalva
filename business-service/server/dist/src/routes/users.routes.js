import { z } from 'zod';
import { UserServiceClient } from '../services/userServiceClient.js';
import { TokenService } from '../services/tokenService.js';
// Simplified Users input schema similar to monolith
const usersSchema = z.object({
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(200).default(20),
    search: z.string().optional(),
    sortBy: z.enum(['name', 'stamp', 'coupon', 'lastVisit']).default('name'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
    filter: z.object({
        hasCoupon: z.boolean().optional(),
        hasVisited: z.number().min(1).optional(),
        minStamp: z.number().min(0).optional(),
    }).optional(),
    businessId: z.string().optional(),
    // Optional per-location drill-down under a BRAND wallet (e.g. "only Lissaro").
    locationId: z.string().optional(),
});
export function registerUsersRoutes(app) {
    // POST /api/v1/users - list CRM users with enrichment
    app.post('/api/v1/users', async (request, reply) => {
        try {
            const input = usersSchema.parse(request.body ?? {});
            const businessId = input.businessId || request.query?.businessId;
            if (!businessId)
                return reply.code(400).send({ message: 'businessId required' });
            // Resolve CRM scope. Under a BRAND wallet the CRM is brand-wide; an explicit
            // locationId narrows the membership query AND the stamp/coupon stats to one
            // pizzeria (per-location drill-down). Under LOCATION scope it stays single.
            const scope = await app.repository.getWalletScope();
            const brandId = app.repository.brandId;
            const drillLocation = input.locationId && (await app.repository.isBusinessInBrand(input.locationId))
                ? input.locationId
                : null;
            const useBrandScope = scope === 'BRAND' && !drillLocation;
            const statsScope = drillLocation
                ? drillLocation
                : (scope === 'BRAND' ? await app.repository.getBrandBusinessIds() : businessId);
            // Integrate with user-service (or mock-user-service) to fetch base users
            const userServiceUrl = process.env.USER_SERVICE_URL || 'http://user-server:3000';
            const tokenService = TokenService.fromEnv();
            const userClient = new UserServiceClient({ baseUrl: userServiceUrl, tokenService });
            const queryFilters = {};
            if (input.filter?.minStamp !== undefined) {
                queryFilters.minStamps = input.filter.minStamp;
            }
            if (input.filter?.hasCoupon) {
                queryFilters.couponsOnly = true;
            }
            if (input.filter?.hasVisited) {
                queryFilters.lastVisitDays = input.filter.hasVisited;
            }
            const queried = await userClient.queryUsers({
                page: input.page,
                limit: input.limit,
                search: input.search,
                businessId: useBrandScope ? undefined : (drillLocation ?? businessId),
                brandId: useBrandScope ? brandId : undefined,
                minStamp: input.filter?.minStamp,
                sortBy: input.sortBy,
                sortOrder: input.sortOrder,
                filters: Object.keys(queryFilters).length ? queryFilters : undefined,
            });
            const baseUsers = queried;
            // Preload prizes once to compute progression for each user without extra queries
            const prizes = await app.repository.listPrizes();
            const thresholds = prizes
                .map((p) => Number(p.pointsRequired))
                .filter((n) => Number.isFinite(n) && n > 0)
                .sort((a, b) => a - b);
            function computeProgression(stamps) {
                let stampsLastPrize = 0;
                let stampsNextPrize = 15;
                let nextPrizeName;
                if (thresholds.length === 0) {
                    const base = 15;
                    stampsLastPrize = Math.floor(stamps / base) * base;
                    stampsNextPrize = stampsLastPrize + base;
                }
                else if (thresholds.length === 1) {
                    const base = thresholds[0];
                    stampsLastPrize = Math.floor(stamps / base) * base;
                    stampsNextPrize = stampsLastPrize + base;
                    const prize = prizes.find((p) => Number(p.pointsRequired) === base);
                    nextPrizeName = prize?.name;
                }
                else {
                    const lastConfig = thresholds.filter((t) => t <= stamps).pop();
                    const nextConfig = thresholds.find((t) => t > stamps);
                    const maxConfig = thresholds[thresholds.length - 1];
                    const baseStep = thresholds[0];
                    if (stamps <= maxConfig) {
                        stampsLastPrize = lastConfig ?? 0;
                        stampsNextPrize = nextConfig ?? (stampsLastPrize + baseStep);
                    }
                    else {
                        stampsLastPrize = Math.floor(stamps / baseStep) * baseStep;
                        stampsNextPrize = stampsLastPrize + baseStep;
                    }
                    const nextPrize = prizes.find((p) => Number(p.pointsRequired) === stampsNextPrize) || prizes.find((p) => Number(p.pointsRequired) === baseStep);
                    nextPrizeName = nextPrize?.name;
                }
                return { stampsLastPrize, stampsNextPrize, nextPrizeName };
            }
            const statsMap = await app.repository.getUsersStatsForBusiness(baseUsers.map((user) => String(user.id)), statsScope);
            const data = baseUsers.map((u) => {
                const stats = statsMap.get(String(u.id)) ?? {
                    totalStamps: 0,
                    validStamps: 0,
                    couponsCount: 0,
                    totalCoupons: 0,
                    lastVisit: null,
                };
                const upstreamValidStamps = u.stats?.validStamps;
                const upstreamTotalStamps = u.stats?.totalStamps;
                const upstreamValidCoupons = u.stats?.validCoupons;
                const upstreamLastVisit = u.stats?.lastVisit;
                const validStamps = upstreamValidStamps ?? stats.validStamps ?? 0;
                const totalStamps = upstreamTotalStamps ?? stats.totalStamps ?? validStamps;
                const prog = computeProgression(validStamps || 0);
                return {
                    id: u.id,
                    email: u.email,
                    phone: u.phone,
                    name: u.name,
                    surname: u.surname,
                    birthday: u.birthday ?? null,
                    validStamps,
                    totalStamps,
                    couponsCount: upstreamValidCoupons ?? stats.couponsCount,
                    totalCoupons: stats.totalCoupons,
                    lastVisit: upstreamLastVisit ?? (stats.lastVisit ? new Date(stats.lastVisit).toISOString() : null),
                    stampsLastPrize: prog.stampsLastPrize,
                    stampsNextPrize: prog.stampsNextPrize,
                    nextPrizeName: prog.nextPrizeName,
                };
            });
            return reply.code(200).send({ message: 'Users retrieved successfully', data });
        }
        catch (e) {
            app.log.error(e);
            return reply.code(400).send({ message: e?.message ?? 'Invalid payload' });
        }
    });
}
