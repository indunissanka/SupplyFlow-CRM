import { describe, it, expect } from 'vitest';
import { unstable_dev } from 'wrangler';

describe('Worker', () => {
  it('should respond to /api/health', async () => {
    // Start the dev worker
    const worker = await unstable_dev('./src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });

    try {
      const resp = await worker.fetch('/api/health');
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('timestamp');
    } finally {
      await worker.stop();
    }
  });

  it('should respond to /api/dashboard', async () => {
    const worker = await unstable_dev('./src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });

    try {
      const resp = await worker.fetch('/api/dashboard');
      expect(resp.status).toBe(200);
      const data = await resp.json();
      expect(data).toHaveProperty('stats');
      expect(data).toHaveProperty('pipeline');
      expect(data).toHaveProperty('activity');
    } finally {
      await worker.stop();
    }
  });

  it('should reject unknown table', async () => {
    const worker = await unstable_dev('./src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });

    try {
      const resp = await worker.fetch('/api/unknown');
      expect(resp.status).toBe(404);
      const data = await resp.json();
      expect(data).toHaveProperty('error', 'Unknown table');
    } finally {
      await worker.stop();
    }
  });
});