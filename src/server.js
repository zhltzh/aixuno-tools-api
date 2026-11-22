import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createStore } from './jobs-store.js';
import { createQueue } from './queue.js';
import { processJob } from './processors/index.js';
import { ensureDirs } from './storage.js';
import { startCleanup } from './cleanup.js';
import { healthRoutes } from './routes/health.js';
import { uploadRoutes } from './routes/uploads.js';
import { jobRoutes } from './routes/jobs.js';

export async function buildApp(logger = true) {
  await ensureDirs();
  const store = createStore();
  const queue = createQueue(store, processJob);
  const app = Fastify({ logger, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  app.decorate('toolsStore', store);
  app.decorate('toolsQueue', queue);
  await app.register(multipart, { attachFieldsToBody: false, limits: { fileSize: config.maxUploadBytes, files: 1 } });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: '1 minute' });
  await app.register(cors, {
    origin: [
      /^https:\/\/([a-z0-9-]+\.)?aixuno\.com$/,
      'https://zhltzh.github.io',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5175',
      'http://127.0.0.1:5176',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
    ],
  });
  await app.register(healthRoutes);
  await app.register(uploadRoutes);
  await app.register(jobRoutes);
  return app;
}

export async function startServer() {
  const app = await buildApp(true);
  startCleanup(app.toolsStore);
  await app.listen({ port: config.port, host: config.host });
  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer().catch((err) => {
    console.error('server failed to start:', err);
    process.exit(1);
  });
}
