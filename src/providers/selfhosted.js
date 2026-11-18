import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const aiDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ai');

function runRestoreScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, [join(aiDir, 'restore.py'), ...args], {
      windowsHide: true,
    });
    let output = '';
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 32 * 1024) output = output.slice(-16 * 1024);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`python not available: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`restore.py exited with ${code}: ${output.trim().slice(-1000)}`));
      }
    });
  });
}

export const selfhostedProvider = {
  name: 'selfhosted',

  async restore(inputPath, outputPath, params = {}, onProgress = () => {}) {
    onProgress(10);
    const args = [
      '--input', inputPath,
      '--output', outputPath,
      '--scale', String(params.scale === 4 ? 4 : params.scale === 1 ? 1 : 2),
    ];
    if (params.face_enhance === false) args.push('--no-face');
    await runRestoreScript(args);
    onProgress(90);
  },
};
