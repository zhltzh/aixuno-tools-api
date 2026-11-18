import { runFfmpeg } from '../lib/ffmpeg.js';

export const mockProvider = {
  name: 'mock',

  async restore(inputPath, outputPath, params = {}, onProgress = () => {}) {
    const scale = params.scale === 2 || params.scale === 4 ? params.scale : 1;
    const vf = ['unsharp=5:5:0.8', 'eq=contrast=1.06:saturation=1.12'];
    if (scale > 1) {
      vf.push(`scale=iw*${scale}:ih*${scale}:flags=lanczos`);
    }
    onProgress(30);
    await runFfmpeg(['-y', '-i', inputPath, '-vf', vf.join(','), outputPath]);
    onProgress(90);
  },
};
