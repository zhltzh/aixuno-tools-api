import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.js';

const API_BASE = 'https://api.replicate.com/v1';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.replicateToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`replicate ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

export const replicateProvider = {
  name: 'replicate',

  async restore(inputPath, outputPath, params = {}, onProgress = () => {}) {
    if (!config.replicateToken) {
      throw new Error('REPLICATE_API_TOKEN is not configured');
    }
    if (!config.replicateModelVersion) {
      throw new Error('REPLICATE_MODEL_VERSION is not configured');
    }
    const image = await readFile(inputPath);
    const dataUri = `data:image/${inputPath.endsWith('.png') ? 'png' : 'jpeg'};base64,${image.toString('base64')}`;
    const prediction = await request('/predictions', {
      method: 'POST',
      body: JSON.stringify({
        version: config.replicateModelVersion,
        input: {
          image: dataUri,
          scale: params.scale === 4 ? 4 : 2,
          ...(params.face_enhance === false ? { face_enhance: false } : {}),
        },
      }),
    });
    let current = prediction;
    for (;;) {
      if (current.status === 'succeeded') break;
      if (current.status === 'failed' || current.status === 'canceled') {
        throw new Error(`replicate prediction ${current.status}: ${current.error || 'unknown'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
      onProgress(30 + Math.min(50, (current.logs || '').length / 100));
      current = await request(`/predictions/${prediction.id}`);
    }
    const output = current.output;
    const outputUrl = Array.isArray(output) ? output[output.length - 1] : output;
    if (!outputUrl || typeof outputUrl !== 'string') {
      throw new Error('replicate returned no output');
    }
    onProgress(85);
    const result = await fetch(outputUrl);
    if (!result.ok) throw new Error(`download result failed (${result.status})`);
    const buffer = Buffer.from(await result.arrayBuffer());
    await writeFile(outputPath, buffer);
    onProgress(95);
  },
};
