import { join } from 'node:path';
import { config, outputDir } from '../config.js';
import { uploadPath } from '../storage.js';
import { mockProvider, replicateProvider, selfhostedProvider } from '../providers/index.js';

export async function processRestore(job, onProgress) {
  const inputPath = uploadPath(job.fileKey);
  const ext = (job.params && job.params.format) === 'jpg' ? '.jpg' : '.png';
  const target = join(outputDir(), `${job.id}${ext}`);
  onProgress(5);
  const provider =
    config.provider === 'replicate'
      ? replicateProvider
      : config.provider === 'selfhosted'
        ? selfhostedProvider
        : mockProvider;
  await provider.restore(inputPath, target, job.params || {}, (p) =>
    onProgress(5 + Math.min(94, p) * 0.9)
  );
  return `${job.id}${ext}`;
}
