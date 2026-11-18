import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { createStore } from './jobs-store.js';
import { createQueue } from './queue.js';
import { processJob } from './processors/index.js';
import { ensureDirs } from './storage.js';
import { startCleanup } from './cleanup.js';

async function main() {
  await ensureDirs();
  const store = createStore();
  if (store.mode !== 'redis') {
    console.error('worker requires REDIS_URL; without it the API runs jobs in-process.');
    process.exit(1);
  }
  createQueue(store, processJob);
  startCleanup(store);
  console.log(`worker started (concurrency=${config.workerConcurrency})`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error('worker failed to start:', err);
    process.exit(1);
  });
}
