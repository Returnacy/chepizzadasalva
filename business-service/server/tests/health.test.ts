import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// The real repository plugin imports the DB package from the Docker path
// (file:///app/db/...), so swap it for a stub. Everything else — both auth
// plugins, the tenant gate and every route — is the real buildApp().
const ping = vi.fn();

vi.mock('../src/plugins/prismaRepositoryPlugin.js', async () => {
  const { default: fp } = await import('fastify-plugin');
  return {
    default: fp(async (fastify: any) => {
      fastify.decorate('repository', {
        brandId: '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47',
        ping,
        getBrandBusinessIds: vi.fn(async () => []),
      });
    }),
  };
});

let app: any;

beforeAll(async () => {
  // keycloakAuthPlugin refuses to register without these; the JWKS is fetched
  // lazily, and none of these requests carries a token, so nothing goes out.
  process.env.SELF_ISSUER = 'https://user-service.example';
  process.env.SELF_ISSUER_JWKS_URL = 'https://user-service.example/.well-known/jwks.json';
  const { buildApp } = await import('../src/app.js');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  ping.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /health', () => {
  it('answers 200 without Authorization when the DB responds', async () => {
    ping.mockResolvedValue(undefined);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('answers 503 without leaking the error when the DB query fails', async () => {
    ping.mockRejectedValue(new Error('PrismaClientInitializationError: secret-host:5432 unreachable'));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'error' });
    expect(res.body).not.toContain('secret-host');
  });

  it('answers 503 when the DB does not answer within 3 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ping.mockReturnValue(new Promise(() => {}));
    const pending = app.inject({ method: 'GET', url: '/health' });
    await vi.advanceTimersByTimeAsync(3000);
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'error' });
  });

  it('checks the DB on every call (no cache)', async () => {
    ping.mockResolvedValue(undefined);
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health' });
    expect(ping).toHaveBeenCalledTimes(2);
  });
});

describe('auth is unchanged everywhere else', () => {
  it('a protected route without a token is still 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/brand/locations' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing or invalid Authorization header' });
  });

  it('POST /health opens no extra surface and never touches the DB', async () => {
    const res = await app.inject({ method: 'POST', url: '/health' });
    expect([401, 404]).toContain(res.statusCode);
    expect(ping).not.toHaveBeenCalled();
  });
});
