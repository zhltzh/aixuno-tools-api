import { config } from '../config.js';

export async function healthRoutes(app) {
  app.get('/api/health', async () => {
    return {
      ok: true,
      queue: config.redisUrl ? 'redis' : 'memory',
      provider: config.provider,
    };
  });
}
