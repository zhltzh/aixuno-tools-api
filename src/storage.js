import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config, uploadDir, outputDir } from './config.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v']);
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/i;

export async function ensureDirs() {
  await mkdir(uploadDir(), { recursive: true });
  await mkdir(outputDir(), { recursive: true });
}

export function isValidKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function uploadPath(key) {
  return join(uploadDir(), key);
}

export function outputPath(fileName) {
  return join(outputDir(), fileName);
}

function pickExtension(kind, fileName) {
  const ext = extname(fileName || '').toLowerCase();
  if (kind === 'video' && VIDEO_EXTS.has(ext)) return ext;
  if (kind === 'image' && IMAGE_EXTS.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (ext && IMAGE_EXTS.has(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (ext && VIDEO_EXTS.has(ext)) return ext;
  return kind === 'video' ? '.mp4' : '.jpg';
}

export async function saveUpload(fileStream, fileName, kind, maxBytes) {
  await ensureDirs();
  const key = `${randomUUID()}${pickExtension(kind, fileName)}`;
  const target = uploadPath(key);
  await pipeline(fileStream, createWriteStream(target));
  const info = await stat(target);
  if (info.size > maxBytes) {
    await unlink(target);
    const err = new Error('file too large');
    err.statusCode = 413;
    throw err;
  }
  return { key, size: info.size };
}

export async function removeQuietly(path) {
  try {
    await unlink(path);
  } catch (err) {
    // already gone
  }
}

export async function cleanOrphanUploads(ttlHours) {
  const cutoff = Date.now() - ttlHours * 3600 * 1000;
  let removed = 0;
  let entries = [];
  try {
    entries = await readdir(uploadDir());
  } catch (err) {
    return removed;
  }
  for (const name of entries) {
    const full = join(uploadDir(), name);
    try {
      const info = await stat(full);
      if (info.mtimeMs < cutoff) {
        await unlink(full);
        removed++;
      }
    } catch (err) {
      // ignore
    }
  }
  return removed;
}

export { config, uploadDir, outputDir };
