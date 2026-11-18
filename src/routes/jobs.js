import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { config } from '../config.js';
import { uploadPath, outputPath, isValidKey } from '../storage.js';

const TYPES = new Set(['watermark', 'restore']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function signToken(id) {
  return createHmac('sha256', config.signSecret).update(id).digest('hex').slice(0, 32);
}

function verifyToken(id, token) {
  const expected = Buffer.from(signToken(id));
  const given = Buffer.from(String(token || ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function jobRoutes(app) {
  app.post('/api/jobs', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = req.body || {};
    const { type, fileKey, params } = body;
    if (!TYPES.has(type)) {
      return reply.code(400).send({ error: 'invalid job type' });
    }
    if (!isValidKey(fileKey)) {
      return reply.code(400).send({ error: 'invalid fileKey' });
    }
    try {
      const info = await stat(uploadPath(fileKey));
      if (!info.isFile()) throw new Error('not a file');
    } catch (err) {
      return reply.code(404).send({ error: 'uploaded file not found' });
    }
    const id = randomUUID();
    const job = {
      id,
      type,
      status: 'queued',
      progress: 0,
      params: params && typeof params === 'object' ? params : {},
      fileKey,
      createdAt: Date.now(),
      expiresAt: Date.now() + config.jobTtlHours * 3600 * 1000,
    };
    await app.toolsStore.create(job);
    await app.toolsQueue.add(id, job);
    return reply.code(201).send({ id, status: job.status, expiresAt: job.expiresAt });
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) {
      return reply.code(400).send({ error: 'invalid job id' });
    }
    const job = await app.toolsStore.get(id);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }
    const result = {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      expiresAt: job.expiresAt,
    };
    if (job.error) result.error = job.error;
    if (job.status === 'done' && job.outputFile) {
      result.resultUrl = `/api/jobs/${job.id}/file?token=${signToken(job.id)}`;
    }
    return reply.send(result);
  });

  app.get('/api/jobs/:id/file', async (req, reply) => {
    const { id } = req.params;
    const token = req.query && req.query.token;
    if (!UUID_RE.test(id) || !verifyToken(id, token)) {
      return reply.code(403).send({ error: 'invalid or missing token' });
    }
    const job = await app.toolsStore.get(id);
    if (!job || job.status !== 'done' || !job.outputFile) {
      return reply.code(404).send({ error: 'result not available' });
    }
    const filePath = outputPath(job.outputFile);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('missing');
    } catch (err) {
      return reply.code(410).send({ error: 'result expired' });
    }
    const ext = job.outputFile.slice(job.outputFile.lastIndexOf('.'));
    reply.type(MIME[ext] || 'application/octet-stream');
    reply.header('Content-Length', (await stat(filePath)).size);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(filePath));
  });
}
