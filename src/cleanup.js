import { join } from 'node:path';
import { readdir, stat, unlink } from 'node:fs/promises';
import { config } from './config.js';
import { uploadPath, outputPath, removeQuietly, cleanOrphanUploads } from './storage.js';

export function startCleanup(store) {
  const ttlHours = config.jobTtlHours;
  const cutoff = () => Date.now() - ttlHours * 3600 * 1000;

  const sweepJobRecords = async () => {
    const now = Date.now();
    const jobs = await store.list();
    for (const job of jobs) {
      if (job.expiresAt && job.expiresAt < now) {
        if (job.fileKey) await removeQuietly(uploadPath(job.fileKey));
        if (job.outputFile) await removeQuietly(outputPath(job.outputFile));
        await store.remove(job.id);
      }
    }
  };

  const sweepOrphanFiles = async () => {
    await cleanOrphanUploads(ttlHours);
    const limit = cutoff();
    let entries = [];
    try {
      entries = await readdir(outputDir());
    } catch (err) {
      return;
    }
    for (const name of entries) {
      const full = join(outputDir(), name);
      try {
        const info = await stat(full);
        if (info.mtimeMs < limit) await unlink(full);
      } catch (err) {
        // ignore
      }
    }
  };

  const sweep = async () => {
    try {
      await sweepJobRecords();
      await sweepOrphanFiles();
    } catch (err) {
      console.error('cleanup sweep failed:', err.message || err);
    }
  };

  setTimeout(sweep, 30 * 1000);
  const timer = setInterval(sweep, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
}
