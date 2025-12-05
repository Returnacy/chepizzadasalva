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
    const { userId } = request.query as { userId: string };

    const lastPrize = await app.repository.getLastNonPromotionalPrize(userId);
    const nextPrize = await app.repository.getNextNonPromotionalPrize(userId);

    // Get all non-promotional prizes to compute sensible defaults
    const prizes = await app.repository.listNonPromotionalPrizes();
    const thresholds = prizes
      .map((p: any) => Number(p.pointsRequired))
      .filter((n: number) => Number.isFinite(n) && n > 0)
      .sort((a: number, b: number) => a - b);

    const DEFAULT_BASE = 15;
    const baseStep = thresholds.length > 0 ? thresholds[0] : DEFAULT_BASE;

    const stampsLastPrize = lastPrize ? Number(lastPrize.pointsRequired) : 0;
    let stampsNextPrize = nextPrize ? Number(nextPrize.pointsRequired) : 0;

    // Ensure stampsNextPrize is always greater than stampsLastPrize
    // This handles edge cases where nextPrize is null or has the same/lower pointsRequired
    if (!stampsNextPrize || stampsNextPrize <= stampsLastPrize) {
      stampsNextPrize = stampsLastPrize + baseStep;
    }

    return reply.send({
      stampsLastPrize,
      stampsNextPrize,
      lastPrizeName: lastPrize?.name,
      nextPrizeName: nextPrize?.name,
    });
  });
}
