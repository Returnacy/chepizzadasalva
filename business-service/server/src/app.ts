// @ts-nocheck
import Fastify from 'fastify';
import cors from '@fastify/cors';
import prismaRepositoryPlugin from './plugins/prismaRepositoryPlugin.js';
import { evaluateTenantAccess } from './authz/tenantAccess.js';
import keycloakAuthPlugin from './plugins/keycloakAuthPlugin.js';
import userAuthPlugin from './plugins/userAuthPlugin.js';
import { registerBusinessRoutes } from './routes/business.routes.js';
import { registerPrizesRoutes } from './routes/prizes.routes.js';
import { registerStampsRoutes } from './routes/stamps.routes.js';
import { registerCouponsRoutes } from './routes/coupons.routes.js';
import { registerUsersRoutes } from './routes/users.routes.js';
import { registerAnalyticsRoutes } from './routes/analytics.routes.js';
import { registerWalletRoutes } from './routes/wallet.routes.js';
import { registerHealthRoutes } from './routes/health.routes.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(keycloakAuthPlugin);
  await app.register(userAuthPlugin);
  await app.register(prismaRepositoryPlugin);

  registerHealthRoutes(app);

  const baseAllowedRoles = new Set(['admin', 'brand_manager', 'manager', 'owner', 'staff']);
  const allowedServices = new Set(
    (process.env.KEYCLOAK_SERVICE_AUDIENCE || 'campaign-service,messaging-service,user-service,business-service')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
  // One deployment serves one brand (DEFAULT_BRAND_ID). The decision itself
  // lives in ./authz/tenantAccess.ts as a pure function so it can be tested
  // without a container — see the note at the top of that file.
  const requireTenantScopedServiceTokens = () => {
    const flag = String(process.env.REQUIRE_TENANT_SERVICE_TOKENS ?? '').toLowerCase().trim();
    return flag === 'true' || flag === '1' || flag === 'yes';
  };

  // Warnings already emitted in this process, for the ones that would otherwise
  // repeat on every single request. See the logging block in the hook below.
  const warnedOnce = new Set<string>();

  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    const path = request.routerPath || (request.raw?.url ? request.raw.url.split('?')[0] : undefined);
    if (request.routeOptions?.config?.public === true) return;
    const auth = (request as any).auth;
    const routeConfig = (request as any).routeConfig ?? request.routeOptions?.config ?? {};
    const allowUserAccess = routeConfig && routeConfig.allowUserAccess === true;
    const allowedRoles = new Set(baseAllowedRoles);
    if (allowUserAccess) allowedRoles.add('user');

    // brandId is a static env value; the location list needs the DB, so a DB
    // blip degrades to brand-only matching instead of locking out every
    // brand-scoped member.
    const ownBrandId = app.repository.brandId;
    let ownBusinessIds: string[] = [];
    try {
      ownBusinessIds = await app.repository.getBrandBusinessIds();
    } catch (err) {
      request.log.error({ err }, '[business-service] could not load brand locations; matching on brandId only');
    }

    const decision = evaluateTenantAccess({
      auth,
      memberships: (request as any).userMemberships ?? [],
      ownBrandId,
      ownBusinessIds,
      allowedRoles,
      allowedServices,
      requireTenantScopedServiceTokens: requireTenantScopedServiceTokens(),
    });

    if (decision.warn) {
      // The rotation-window notice is once per client id per process: every
      // stamp passes through here, so a per-request warn would bury the very
      // signal the rotation runbook tells you to watch for. Refusals are never
      // deduped — each one is an event worth seeing.
      const dedupe = decision.allow && decision.warn.includes('rotation window');
      const key = `${decision.warn}::${auth?.azp ?? ''}`;
      if (!dedupe || !warnedOnce.has(key)) {
        if (dedupe) warnedOnce.add(key);
        request.log.warn(
          { path, ownBrandId, azp: auth?.azp, oncePerProcess: dedupe },
          `[business-service] ${decision.warn}`,
        );
      }
    }
    if (!decision.allow) {
      return reply.status(decision.status).send(
        decision.message ? { error: decision.error, message: decision.message } : { error: decision.error },
      );
    }
  });

  registerBusinessRoutes(app);
  registerPrizesRoutes(app);
  registerStampsRoutes(app);
  registerCouponsRoutes(app);
  registerUsersRoutes(app);
  registerAnalyticsRoutes(app);
  registerWalletRoutes(app);

  return app;
}

// Start if invoked directly (not during tests)
// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
  const isTest = process.env.NODE_ENV === 'test';
  if (isTest) return;
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen({ port, host });
})();
