import { Queue, Worker } from 'bullmq';
import { config } from './config.js';

class MemoryQueue {
  constructor(store, processor, concurrency) {
    this.store = store;
    this.processor = processor;
    this.concurrency = Math.max(1, concurrency);
    this.pending = [];
    this.active = 0;
    this.mode = 'memory';
  }

  add(jobId) {
    this.pending.push(jobId);
    this._drain();
  }

  _drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      this.active++;
      this._run(id)
        .catch(() => {})
        .finally(() => {
          this.active--;
          this._drain();
        });
    }
  }

  async _run(id) {
    const job = await this.store.get(id);
    if (!job || job.status !== 'queued') return;
    await this.store.update(id, { status: 'processing', progress: 0 });
    try {
      const outputFile = await this.processor(job, async (progress) => {
        await this.store.update(id, { progress: Math.round(progress) });
      });
      await this.store.update(id, {
        status: 'done',
        progress: 100,
        outputFile,
        finishedAt: Date.now(),
      });
    } catch (err) {
      await this.store.update(id, {
        status: 'failed',
        error: String(err.message || err).slice(0, 500),
        finishedAt: Date.now(),
      });
    }
  }
}

class BullMQueue {
  constructor(store, processor, concurrency) {
    this.store = store;
    this.processor = processor;
    this.mode = 'redis';
    this.queue = new Queue(config.queueName, { connection: { url: config.redisUrl } });
    this.worker = new Worker(
      config.queueName,
      async (bullJob) => {
        const job = bullJob.data;
        await this.store.update(job.id, { status: 'processing', progress: 0 }).catch(() => {});
        const onProgress = async (progress) => {
          try {
            await bullJob.updateProgress(Math.round(progress));
          } catch (err) {
            // ignore
          }
          await this.store.update(job.id, { progress: Math.round(progress) });
        };
        const outputFile = await this.processor(job, onProgress);
        await this.store.update(job.id, {
          status: 'done',
          progress: 100,
          outputFile,
          finishedAt: Date.now(),
        });
        return { outputFile };
      },
      {
        connection: { url: config.redisUrl },
        concurrency: Math.max(1, concurrency),
      }
    );
    this.worker.on('failed', async (bullJob, err) => {
      if (bullJob && bullJob.data) {
        await this.store.update(bullJob.data.id, {
          status: 'failed',
          error: String(err.message || err).slice(0, 500),
          finishedAt: Date.now(),
        });
      }
    });
  }

  async add(jobId, job) {
    await this.queue.add('job', job, { jobId, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
}

export function createQueue(store, processor) {
  if (config.redisUrl) {
    return new BullMQueue(store, processor, config.workerConcurrency);
  }
  return new MemoryQueue(store, processor, config.workerConcurrency);
}
