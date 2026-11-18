import { config } from './config.js';
import { uploadPath, outputPath, removeQuietly, cleanOrphanUploads } from './storage.js';

export function startCleanup(store) {
  const ttlHours = config.jobTtlHours;
  const sweep = async () => {
    try {
      const now = Date.now();
      const jobs = await store.list();
      for (const job of jobs) {
        if (job.expiresAt && job.expiresAt < now) {
          if (job.fileKey) await removeQuietly(uploadPath(job.fileKey));
          if (job.outputFile) await removeQuietly(outputPath(job.outputFile));
          await store.remove(job.id);
        }
      }
      await cleanOrphanUploads(ttlHours);
    } catch (err) {
      console.error('cleanup sweep failed:', err.message || err);
    }
  };
  setTimeout(sweep, 30 * 1000);
  const timer = setInterval(sweep, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
}
