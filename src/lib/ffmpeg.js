import { spawn } from 'node:child_process';
import { config } from '../config.js';

export function runFfmpeg(args, totalSeconds = 0, onProgress = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], {
      windowsHide: true,
    });
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, 10 * 60 * 1000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-32 * 1024);
    });
    child.stdout.on('data', (chunk) => {
      if (!onProgress || totalSeconds <= 0) return;
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^out_time_us=(\d+)/);
        if (match) {
          const seconds = Number(match[1]) / 1e6;
          onProgress(Math.min(99, (seconds / totalSeconds) * 100));
        }
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg not available: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error('ffmpeg timed out'));
      } else if (code !== 0) {
        reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(-2000)}`));
      } else {
        resolve();
      }
    });
  });
}

export async function probeMedia(file) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(config.ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file,
    ], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
    });
    child.on('error', (err) => reject(new Error(`ffprobe not available: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}`));
        return;
      }
      resolve(out);
    });
  });
  const info = JSON.parse(raw);
  const stream = info.streams && info.streams[0];
  if (!stream) throw new Error('no video stream found');
  return {
    width: stream.width,
    height: stream.height,
    duration: Number(info.format && info.format.duration) || 0,
  };
}
