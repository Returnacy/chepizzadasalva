import type { FastifyInstance } from 'fastify';

// Railway calls this during a deploy and only promotes the new container on a 2xx.
// A container that boots but cannot load the Prisma engine or reach Postgres must
// answer 503 here, so the previous deployment keeps serving. No auth (Railway's probe
// has no token), and the body never carries error details, versions or host names.
const DB_TIMEOUT_MS = 3000;

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', { config: { public: true } }, async (request: any, reply: any) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        app.repository.ping(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('database ping timed out')), DB_TIMEOUT_MS);
        }),
      ]);
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      request.log.warn({ err }, '[business-service] health check: database unreachable');
      return reply.status(503).send({ status: 'degraded', db: 'error' });
    } finally {
      clearTimeout(timer);
    }
  });
}
