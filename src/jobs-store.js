import Redis from 'ioredis';
import { config } from './config.js';

const PREFIX = 'aixtools:job:';

class MemoryStore {
  constructor() {
    this.map = new Map();
    this.mode = 'memory';
  }

  async create(job) {
    this.map.set(job.id, { ...job });
    return { ...job };
  }

  async get(id) {
    const job = this.map.get(id);
    return job ? { ...job } : null;
  }

  async update(id, patch) {
    const job = this.map.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    return { ...job };
  }

  async remove(id) {
    this.map.delete(id);
  }

  async list() {
    return [...this.map.values()].map((j) => ({ ...j }));
  }
}

class RedisStore {
  constructor() {
    this.redis = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.mode = 'redis';
  }

  async create(job) {
    await this.redis.set(PREFIX + job.id, JSON.stringify(job));
    return job;
  }

  async get(id) {
    const raw = await this.redis.get(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  }

  async update(id, patch) {
    const job = await this.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    await this.redis.set(PREFIX + id, JSON.stringify(job));
    return job;
  }

  async remove(id) {
    await this.redis.del(PREFIX + id);
  }

  async list() {
    const keys = await this.redis.keys(PREFIX + '*');
    if (!keys.length) return [];
    const values = await this.redis.mget(...keys);
    return values.filter(Boolean).map((v) => JSON.parse(v));
  }
}

export function createStore() {
  return config.redisUrl ? new RedisStore() : new MemoryStore();
}
