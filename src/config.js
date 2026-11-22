import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '127.0.0.1',
  dataDir: process.env.DATA_DIR || join(packageRoot, 'data'),
  redisUrl: process.env.REDIS_URL || '',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  ffmpegVcodec: process.env.FFMPEG_VCODEC || 'libx264',
  ffmpegVbitrate: process.env.FFMPEG_VBITRATE || '6M',
  jobTtlHours: Number(process.env.JOB_TTL_HOURS || 24),
  provider: process.env.AI_PROVIDER || 'mock',
  pythonBin: process.env.PYTHON_BIN || 'python3',
  replicateToken: process.env.REPLICATE_API_TOKEN || '',
  replicateModelVersion: process.env.REPLICATE_MODEL_VERSION || '',
  signSecret: process.env.SIGN_SECRET || 'dev-secret-change-me',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 220 * 1024 * 1024),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 2),
  queueName: 'aixuno-tools-jobs',
};

export function uploadDir() {
  return join(config.dataDir, 'uploads');
}

export function outputDir() {
  return join(config.dataDir, 'outputs');
}
