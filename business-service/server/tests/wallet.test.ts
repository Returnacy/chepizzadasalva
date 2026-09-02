import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';

// The GET status route reaches user-service twice: an HTTP /me probe through
// global fetch, and getWalletPass through the axios-based client. Both are
// stubbed so a test can assert they are NOT reached when Wallet is unconfigured.
const getWalletPass = vi.fn();
const upsertWalletPass = vi.fn();

vi.mock('../src/services/userServiceClient.js', () => ({
  UserServiceClient: class {
    getWalletPass = getWalletPass;
    upsertWalletPass = upsertWalletPass;
  },
}));

const { registerWalletRoutes } = await import('../src/routes/wallet.routes.js');
const { isWalletConfigured } = await import('../src/utils/googleWallet.js');

const BUSINESS_ID = 'af941888-ec4c-458e-b905-21673241af3e';

const WALLET_ENV = {
  GOOGLE_WALLET_LOYALTY_CLASS_ID: '3388000000012345678.returnacy-loyalty',
  GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet@example.iam.gserviceaccount.com',
  GOOGLE_WALLET_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
};

const WALLET_ENV_KEYS = [
  'GOOGLE_WALLET_LOYALTY_CLASS_ID',
  'GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_WALLET_PRIVATE_KEY',
  'GOOGLE_WALLET_ISSUER_ID',
];

let savedEnv: Record<string, string | undefined> = {};
let fetchSpy: ReturnType<typeof vi.fn>;

function clearWalletEnv() {
  for (const key of WALLET_ENV_KEYS) delete process.env[key];
}

function setWalletEnv() {
  Object.assign(process.env, WALLET_ENV);
}

function buildApp() {
  const app = Fastify();
  registerWalletRoutes(app);
  return app;
}

const PROFILE = {
  id: 'user-1',
  email: 'cliente@example.com',
  name: 'Mario',
  surname: 'Rossi',
  memberships: [{ businessId: BUSINESS_ID, roles: ['user'] }],
};

beforeEach(() => {
  savedEnv = {};
  for (const key of WALLET_ENV_KEYS) savedEnv[key] = process.env[key];
  clearWalletEnv();

  // createUserServiceClient() builds a TokenService from env before anything else.
  process.env.KEYCLOAK_TOKEN_URL = 'https://keycloak.example/token';
  process.env.KEYCLOAK_CLIENT_ID = 'business-service';
  process.env.KEYCLOAK_CLIENT_SECRET = 'secret';

  getWalletPass.mockReset();
  upsertWalletPass.mockReset();

  fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => PROFILE,
    text: async () => JSON.stringify(PROFILE),
  }));
  (globalThis as any).fetch = fetchSpy;
});

afterEach(() => {
  clearWalletEnv();
  for (const key of WALLET_ENV_KEYS) {
    if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key] as string;
  }
});

describe('isWalletConfigured', () => {
  it('is false when nothing is set (a freshly provisioned brand)', () => {
    expect(isWalletConfigured()).toBe(false);
  });

  it('is true with class id, service account and private key', () => {
    setWalletEnv();
    expect(isWalletConfigured()).toBe(true);
  });

  it.each(Object.keys(WALLET_ENV))('is false when %s is missing', (missing) => {
    setWalletEnv();
    delete process.env[missing];
    expect(isWalletConfigured()).toBe(false);
  });

  it('is false when a required value is blank rather than absent', () => {
    setWalletEnv();
    process.env.GOOGLE_WALLET_PRIVATE_KEY = '   ';
    expect(isWalletConfigured()).toBe(false);
  });

  it('requires an explicit issuer id only when the class id carries no dot', () => {
    setWalletEnv();
    process.env.GOOGLE_WALLET_LOYALTY_CLASS_ID = 'returnacy-loyalty';
    expect(isWalletConfigured()).toBe(false);

    process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000012345678';
    expect(isWalletConfigured()).toBe(true);
  });

  it('does not throw when the env is empty', () => {
    expect(() => isWalletConfigured()).not.toThrow();
  });
});

describe('GET /api/v1/wallet/google', () => {
  it('reports configured:false without asking user-service anything', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/wallet/google?businessId=${BUSINESS_ID}`,
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, linked: false, objectId: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getWalletPass).not.toHaveBeenCalled();
    await app.close();
  });

  it('answers configured:false even without an Authorization header', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/wallet/google?businessId=${BUSINESS_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, linked: false, objectId: null });
    await app.close();
  });

  it('still rejects a request without businessId', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/wallet/google' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_QUERY');
    await app.close();
  });

  it('keeps the existing payload and adds configured:true when configured', async () => {
    setWalletEnv();
    getWalletPass.mockResolvedValue({ linked: true, objectId: 'issuer.business-user-1' });

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/wallet/google?businessId=${BUSINESS_ID}`,
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: true, linked: true, objectId: 'issuer.business-user-1' });
    expect(getWalletPass).toHaveBeenCalledWith('user-1', BUSINESS_ID);
    await app.close();
  });

  it('reports an unlinked pass as configured:true, linked:false', async () => {
    setWalletEnv();
    getWalletPass.mockResolvedValue(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/wallet/google?businessId=${BUSINESS_ID}`,
      headers: { authorization: 'Bearer token' },
    });

    expect(res.json()).toEqual({ configured: true, linked: false, objectId: null });
    await app.close();
  });

  it('still refuses a business the caller has no membership in', async () => {
    setWalletEnv();

    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/wallet/google?businessId=someone-elses-business',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(403);
    expect(getWalletPass).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /api/v1/wallet/google', () => {
  it('refuses with 409 WALLET_NOT_CONFIGURED before any upstream call', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/wallet/google',
      headers: { authorization: 'Bearer token' },
      payload: { businessId: BUSINESS_ID },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'WALLET_NOT_CONFIGURED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getWalletPass).not.toHaveBeenCalled();
    expect(upsertWalletPass).not.toHaveBeenCalled();
    await app.close();
  });

  it('still rejects a malformed payload before the configuration check', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/wallet/google',
      headers: { authorization: 'Bearer token' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_PAYLOAD');
    await app.close();
  });

  it('gets past the configuration check when the Wallet env is present', async () => {
    setWalletEnv();
    getWalletPass.mockResolvedValue(null);

    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/wallet/google',
      headers: { authorization: 'Bearer token' },
      payload: { businessId: BUSINESS_ID },
    });

    // No repository is decorated on this bare instance, so issuance stops one
    // step later — the point is that it is no longer stopped by 409.
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('SERVER_MISCONFIGURED');
    expect(fetchSpy).toHaveBeenCalled();
    await app.close();
  });
});
