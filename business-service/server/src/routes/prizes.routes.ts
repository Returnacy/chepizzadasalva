import type { FastifyInstance } from 'fastify';

export function registerPrizesRoutes(app: FastifyInstance) {
  app.get('/api/v1/prizes', async (request: any) => {
    const prizes = await app.repository.listPrizes();
    return { prizes };
  });

  // Compute progression boundaries (last and next prize thresholds) given a user's current stamps
  // Input: { businessId: string, stamps: number }
  // Output: { stampsLastPrize: number, stampsNextPrize: number, lastPrizeName?: string, nextPrizeName?: string }
  app.get('/api/v1/prizes/progression', async (request: any, reply: any) => {
    const userId = request.query as { userId: string };

    const lastPrize = await app.repository.getLastNonPromotionalPrize(userId);
    const nextPrize = await app.repository.getNextNonPromotionalPrize(userId);

    return reply.send({
      stampsLastPrize: lastPrize ? Number(lastPrize.pointsRequired) : 0,
      stampsNextPrize: nextPrize ? Number(nextPrize.pointsRequired) : 0,
      lastPrizeName: lastPrize?.name,
      nextPrizeName: nextPrize?.name,
    });
  });
}
