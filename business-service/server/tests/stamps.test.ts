import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

// The counter sync to user-service is the slow, fallible tail of a scan: it is
// stubbed so a test can make it fail or hang and check the staff's response
// does not depend on it.
const updateMembershipCounters = vi.fn();
const fromEnv = vi.fn(() => ({}));

vi.mock('../src/services/userServiceClient.js', () => ({
  UserServiceClient: class {
    updateMembershipCounters = updateMembershipCounters;
  },
}));
vi.mock('../src/services/tokenService.js', () => ({
  TokenService: { fromEnv },
}));

const { registerStampsRoutes } = await import('../src/routes/stamps.routes.js');

const BUSINESS_ID = 'af941888-ec4c-458e-b905-21673241af3e';
const PIZZA = { id: 'prize-1', name: 'Pizza omaggio', pointsRequired: 15 };

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    brandId: 'brand-1',
    isBusinessInBrand: vi.fn(async () => true),
    addStamps: vi.fn(async () => ({ count: 0 })),
    countValidStamps: vi.fn(async () => 3),
    getNextNonPromotionalPrize: vi.fn(async () => PIZZA),
    getLastNonPromotionalPrize: vi.fn(async () => null),
    createCoupon: vi.fn(async () => ({ id: 'coupon-1', code: 'ABC123' })),
    listStamps: vi.fn(async () => []),
    redeemStamps: vi.fn(async () => ({ count: 0 })),
    getWalletScope: vi.fn(async () => 'BRAND'),
    ...overrides,
  };
}

function buildApp(repository: ReturnType<typeof makeRepository>) {
  const app = Fastify();
  app.decorate('repository', repository as any);
  registerStampsRoutes(app);
  return app;
}

function apply(app: ReturnType<typeof buildApp>, stamps: number) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/stamps/apply',
    payload: { userId: 'user-1', businessId: BUSINESS_ID, stamps },
  });
}

beforeEach(() => {
  updateMembershipCounters.mockReset();
  fromEnv.mockClear();
});

describe('POST /api/v1/stamps/apply', () => {
  it('inserts all N stamps in one batch and returns the progression', async () => {
    updateMembershipCounters.mockResolvedValue(undefined);
    const repository = makeRepository();
    const app = buildApp(repository);

    const res = await apply(app, 3);

    expect(res.statusCode).toBe(200);
    expect(repository.addStamps).toHaveBeenCalledTimes(1);
    expect(repository.addStamps).toHaveBeenCalledWith('user-1', BUSINESS_ID, 3);
    expect(res.json()).toEqual({
      message: 'Stamps applied',
      data: {
        validStamps: 3,
        createdCoupon: null,
        nextPrize: { name: 'Pizza omaggio', stampsLastPrize: 0, stampsNextPrize: 15 },
      },
    });
    await vi.waitFor(() => expect(updateMembershipCounters).toHaveBeenCalledTimes(1));
    expect(updateMembershipCounters).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      businessId: BUSINESS_ID,
      brandId: 'brand-1',
      scope: 'BRAND',
      validStamps: 3,
      totalStampsDelta: 3,
      totalCouponsDelta: 0,
    }));
  });

  it('answers even when the user-service sync fails', async () => {
    updateMembershipCounters.mockRejectedValue(new Error('user-service down'));
    const app = buildApp(makeRepository());

    const res = await apply(app, 1);

    expect(res.statusCode).toBe(200);
    expect(res.json().data.validStamps).toBe(3);
    await vi.waitFor(() => expect(updateMembershipCounters).toHaveBeenCalledTimes(1));
  });

  it('answers before a hanging user-service sync settles', async () => {
    updateMembershipCounters.mockReturnValue(new Promise(() => {}));
    const app = buildApp(makeRepository());

    const res = await apply(app, 1);

    expect(res.statusCode).toBe(200);
  });

  it('builds the user-service client once, not per request', async () => {
    updateMembershipCounters.mockResolvedValue(undefined);
    const app = buildApp(makeRepository());

    await apply(app, 1);
    await apply(app, 1);
    await vi.waitFor(() => expect(updateMembershipCounters).toHaveBeenCalledTimes(2));

    expect(fromEnv).toHaveBeenCalledTimes(1);
  });

  it('on reaching the prize: creates the coupon, redeems the oldest stamps in one update, returns the new progression', async () => {
    updateMembershipCounters.mockResolvedValue(undefined);
    const stamps = Array.from({ length: 15 }, (_, i) => ({ id: `stamp-${i}` }));
    const repository = makeRepository({
      countValidStamps: vi.fn(async () => 16),
      listStamps: vi.fn(async () => stamps),
      // Before the coupon there is no last prize; after it, the pizza is the last one.
      getLastNonPromotionalPrize: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(PIZZA),
    });
    const app = buildApp(repository);

    const res = await apply(app, 2);

    expect(res.statusCode).toBe(200);
    expect(repository.createCoupon).toHaveBeenCalledTimes(1);
    expect(repository.listStamps).toHaveBeenCalledWith('user-1', BUSINESS_ID, { isRedeemed: false, take: 15 });
    expect(repository.redeemStamps).toHaveBeenCalledTimes(1);
    expect(repository.redeemStamps).toHaveBeenCalledWith(stamps.map(s => s.id));
    expect(res.json().data).toEqual({
      validStamps: 1,
      createdCoupon: { id: 'coupon-1', code: 'ABC123' },
      nextPrize: { name: 'Pizza omaggio', stampsLastPrize: 15, stampsNextPrize: 15 },
    });
    await vi.waitFor(() => expect(updateMembershipCounters).toHaveBeenCalledWith(expect.objectContaining({
      validStamps: 1,
      validCoupons: 1,
      totalCouponsDelta: 1,
    })));
  });

  it('still rejects a location outside the brand without writing', async () => {
    const repository = makeRepository({ isBusinessInBrand: vi.fn(async () => false) });
    const app = buildApp(repository);

    const res = await apply(app, 1);

    expect(res.statusCode).toBe(400);
    expect(repository.addStamps).not.toHaveBeenCalled();
  });
});
