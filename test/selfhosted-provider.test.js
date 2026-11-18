import { describe, it, expect } from 'vitest';

process.env.AI_PROVIDER = 'selfhosted';
process.env.PYTHON_BIN = 'aixuno-missing-python';

const { selfhostedProvider } = await import('../src/providers/selfhosted.js');

describe('selfhosted AI provider', () => {
  it('propagates a clear error when python is unavailable', async () => {
    await expect(selfhostedProvider.restore('in.jpg', 'out.png', {})).rejects.toThrow(
      /python not available/
    );
  });
});
