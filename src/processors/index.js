export async function processJob(job, onProgress) {
  if (job.type === 'watermark') {
    const { processWatermark } = await import('./watermark.js');
    return processWatermark(job, onProgress);
  }
  if (job.type === 'restore') {
    const { processRestore } = await import('./restore.js');
    return processRestore(job, onProgress);
  }
  throw new Error(`unknown job type: ${job.type}`);
}
