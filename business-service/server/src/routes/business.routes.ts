import type { FastifyInstance } from 'fastify';

export function registerBusinessRoutes(app: FastifyInstance) {
  // Internal endpoint for available messages (capacity) driven by DB counters
  app.post('/internal/v1/business/:id/available-messages', async (request: any) => {
    const { id } = request.params as { id: string };
    const cap = await app.repository.getBusinessCapacity(id);
    if (!cap) return { email: 0, sms: 0, push: 0 };
    return { email: cap.email, sms: cap.sms, push: cap.push };
  });
}
