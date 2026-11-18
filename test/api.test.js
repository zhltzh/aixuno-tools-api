import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aixuno-tools-test-'));
process.env.WORKER_CONCURRENCY = '1';

const { buildApp } = await import('../src/server.js');

let app;
let base;
let imageKey;
let videoKey;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(buffer, filename, kind) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('kind', kind);
  const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
  expect(res.status).toBe(200);
  return res.json();
}

async function createJob(payload) {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res;
}

async function waitForDone(id, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/jobs/${id}`);
    last = await res.json();
    if (last.status === 'done') return last;
    if (last.status === 'failed') throw new Error(`job failed: ${last.error}`);
    await sleep(400);
  }
  throw new Error(`timeout, last=${JSON.stringify(last)}`);
}

beforeAll(async () => {
  const fixtures = join(process.env.DATA_DIR, 'fixtures');
  mkdirSync(fixtures, { recursive: true });
  const gen = (args) => {
    const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`fixture ffmpeg failed: ${result.stderr}`);
  };
  gen([
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac',
    join(fixtures, 'input.mp4'),
  ]);
  gen(['-f', 'lavfi', '-i', 'color=c=gray:size=400x300:rate=1', '-frames:v', '1', join(fixtures, 'photo.jpg')]);

  app = await buildApp(false);
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.server.address().port}`;

  imageKey = (await upload(await readFile(join(fixtures, 'photo.jpg')), 'photo.jpg', 'image')).fileKey;
  videoKey = (await upload(await readFile(join(fixtures, 'input.mp4')), 'input.mp4', 'video')).fileKey;
});

afterAll(async () => {
  await app.close();
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

describe('aixuno-tools-api', () => {
  it('reports health', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.queue).toBe('memory');
  });

  it('rejects invalid uploads', async () => {
    const form = new FormData();
    form.append('kind', 'image');
    const res = await fetch(`${base}/api/uploads`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('rejects jobs with unknown fileKey', async () => {
    const res = await createJob({ type: 'restore', fileKey: '00000000-0000-4000-8000-000000000000.jpg' });
    expect(res.status).toBe(404);
  });

  it('processes a restore job through the mock provider', async () => {
    const created = await createJob({ type: 'restore', fileKey: imageKey, params: { scale: 1 } });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const job = await waitForDone(id);
    expect(job.resultUrl).toContain(`/api/jobs/${id}/file?token=`);

    const fileRes = await fetch(`${base}${job.resultUrl}`);
    expect(fileRes.status).toBe(200);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
  });

  it('removes a watermark with delogo', async () => {
    const created = await createJob({
      type: 'watermark',
      fileKey: videoKey,
      params: { method: 'delogo', regions: [{ x: 0.7, y: 0.75, w: 0.2, h: 0.12 }] },
    });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const job = await waitForDone(id);
    const fileRes = await fetch(`${base}${job.resultUrl}`);
    expect(fileRes.status).toBe(200);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    expect(buf.subarray(4, 8).toString()).toBe('ftyp');
  });

  it('removes a watermark with blur', async () => {
    const created = await createJob({
      type: 'watermark',
      fileKey: videoKey,
      params: { method: 'blur', regions: [{ x: 0.05, y: 0.05, w: 0.3, h: 0.15 }] },
    });
    const { id } = await created.json();
    const job = await waitForDone(id);
    const fileRes = await fetch(`${base}${job.resultUrl}`);
    expect(fileRes.status).toBe(200);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    expect(buf.subarray(4, 8).toString()).toBe('ftyp');
  });

  it('removes edge watermarks with crop', async () => {
    const created = await createJob({
      type: 'watermark',
      fileKey: videoKey,
      params: { method: 'crop', regions: [{ x: 0.02, y: 0.02, w: 0.3, h: 0.14 }] },
    });
    const { id } = await created.json();
    const job = await waitForDone(id);
    const fileRes = await fetch(`${base}${job.resultUrl}`);
    expect(fileRes.status).toBe(200);
    const buf = Buffer.from(await fileRes.arrayBuffer());
    expect(buf.subarray(4, 8).toString()).toBe('ftyp');
  });

  it('rejects download without token', async () => {
    const created = await createJob({ type: 'restore', fileKey: imageKey, params: {} });
    const { id } = await created.json();
    await waitForDone(id);
    const res = await fetch(`${base}/api/jobs/${id}/file`);
    expect(res.status).toBe(403);
  });

  it('rejects watermark jobs without regions', async () => {
    const created = await createJob({ type: 'watermark', fileKey: videoKey, params: { method: 'delogo', regions: [] } });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    await sleep(300);
    const res = await fetch(`${base}/api/jobs/${id}`);
    const job = await res.json();
    expect(job.status).toBe('failed');
  });
});
