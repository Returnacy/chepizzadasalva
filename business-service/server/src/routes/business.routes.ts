import type { FastifyInstance } from 'fastify';

export function registerBusinessRoutes(app: FastifyInstance) {
  // Internal endpoint for available messages (capacity) driven by DB counters
  app.post('/internal/v1/business/:id/available-messages', async (request: any) => {
    const { id } = request.params as { id: string };
    const cap = await app.repository.getBusinessCapacity(id);
    if (!cap) return { email: 0, sms: 0, push: 0 };
    return { email: cap.email, sms: cap.sms, push: cap.push };
  });

  // Locations of the brand + its wallet scope — drives the staff location picker.
  app.get('/api/v1/brand/locations', async () => {
    const [locations, walletScope] = await Promise.all([
      app.repository.listBrandLocations(),
      app.repository.getWalletScope(),
    ]);
    return { brandId: app.repository.brandId, walletScope, locations };
  });
}
