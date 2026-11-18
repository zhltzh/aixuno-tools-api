import { probeMedia, runFfmpeg } from '../lib/ffmpeg.js';
import { uploadPath, outputDir } from '../storage.js';
import { join } from 'node:path';

function clampRegion(region, width, height) {
  let x = Math.max(0, Math.round(region.x * width));
  let y = Math.max(0, Math.round(region.y * height));
  let w = Math.max(1, Math.round(region.w * width));
  let h = Math.max(1, Math.round(region.h * height));
  x = Math.min(x, width - 2);
  y = Math.min(y, height - 2);
  w = Math.max(1, Math.min(w, width - 1 - x));
  h = Math.max(1, Math.min(h, height - 1 - y));
  return { x, y, w, h };
}

function buildDelogoVf(regions, width, height) {
  return regions
    .map((r) => {
      const c = clampRegion(r, width, height);
      return `delogo=x=${c.x}:y=${c.y}:w=${c.w}:h=${c.h}`;
    })
    .join(',');
}

function buildBlurFilterComplex(regions, width, height) {
  const n = regions.length;
  const clamped = regions.map((r) => clampRegion(r, width, height));
  const splitTargets = [];
  for (let i = 0; i < n; i++) splitTargets.push(`[wm${i}]`);
  const chains = [`[0:v]split=${n + 1}[base]${splitTargets.join('')}`];
  for (let i = 0; i < n; i++) {
    const r = clamped[i];
    chains.push(`[wm${i}]crop=${r.w}:${r.h}:${r.x}:${r.y},boxblur=8:2[bl${i}]`);
  }
  let prev = 'base';
  for (let i = 0; i < n; i++) {
    const label = i === n - 1 ? 'vout' : `ov${i}`;
    chains.push(`[${prev}][bl${i}]overlay=${clamped[i].x}:${clamped[i].y}[${label}]`);
    prev = label;
  }
  return chains.join(';');
}

function intersectRect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

export function buildCropRect(regions, width, height) {
  let rect = { x: 0, y: 0, w: width, h: height };
  for (const region of regions) {
    const cx = region.x * width;
    const cy = region.y * height;
    const cw = region.w * width;
    const ch = region.h * height;
    const dLeft = cx;
    const dRight = width - (cx + cw);
    const dTop = cy;
    const dBottom = height - (cy + ch);
    const min = Math.min(dLeft, dRight, dTop, dBottom);
    if (min > width * 0.08 && min > height * 0.08) return null;
    let candidate;
    if (min === dLeft) candidate = { x: cx + cw, y: 0, w: width - (cx + cw), h: height };
    else if (min === dRight) candidate = { x: 0, y: 0, w: cx, h: height };
    else if (min === dTop) candidate = { x: 0, y: cy + ch, w: width, h: height - (cy + ch) };
    else candidate = { x: 0, y: 0, w: width, h: cy };
    rect = intersectRect(rect, candidate);
    if (rect.w <= 0 || rect.h <= 0) return null;
  }
  if ((rect.w * rect.h) / (width * height) < 0.3) return null;
  return rect;
}

export async function processWatermark(job, onProgress) {
  const params = job.params || {};
  const method = params.method || 'delogo';
  const regions = Array.isArray(params.regions) ? params.regions : [];
  if (!regions.length) throw new Error('no watermark regions provided');
  if (regions.length > 8) throw new Error('too many regions (max 8)');
  for (const r of regions) {
    if (
      typeof r.x !== 'number' || typeof r.y !== 'number' ||
      typeof r.w !== 'number' || typeof r.h !== 'number' ||
      r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 ||
      r.x + r.w > 1.001 || r.y + r.h > 1.001
    ) {
      throw new Error('invalid region');
    }
  }
  const inputPath = uploadPath(job.fileKey);
  const meta = await probeMedia(inputPath);
  const target = join(outputDir(), `${job.id}.mp4`);
  onProgress(2);
  let filterArgs;
  if (method === 'crop') {
    const rect = buildCropRect(regions, meta.width, meta.height);
    if (rect) {
      filterArgs = ['-vf', `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`];
    } else {
      filterArgs = ['-vf', buildDelogoVf(regions, meta.width, meta.height)];
    }
  } else if (method === 'blur') {
    filterArgs = [
      '-filter_complex', buildBlurFilterComplex(regions, meta.width, meta.height),
      '-map', '[vout]',
      '-map', '0:a?',
    ];
  } else {
    filterArgs = ['-vf', buildDelogoVf(regions, meta.width, meta.height)];
  }
  await runFfmpeg(
    [
      '-y',
      '-i', inputPath,
      ...filterArgs,
      '-c:v', 'libx264',
      '-crf', '18',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      '-nostats',
      target,
    ],
    meta.duration,
    (p) => onProgress(2 + Math.min(96, p) * 0.97)
  );
  return `${job.id}.mp4`;
}
