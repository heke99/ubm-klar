import { describe, expect, it } from 'vitest';
import type { TenantDirectory } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';

const emptyDirectory: TenantDirectory = { lookupByDomain: async () => undefined };

describe('readiness endpoint', () => {
  it('is ready when all required checks pass', async () => {
    const app = buildApiServer({
      directory: emptyDirectory,
      allowDemoTenant: true,
      readinessChecks: [
        { name: 'dependency_a', required: true, run: async () => ({ ok: true }) },
        { name: 'optional_b', required: false, run: async () => ({ ok: false, detail: 'off' }) },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().ready).toBe(true);
    expect(response.json().checks).toHaveLength(2);
  });

  it('fails closed (503) when a required dependency is down, naming the check', async () => {
    const app = buildApiServer({
      directory: emptyDirectory,
      allowDemoTenant: true,
      readinessChecks: [
        {
          name: 'database',
          required: true,
          run: async () => ({ ok: false, detail: 'unreachable' }),
        },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().ready).toBe(false);
    expect(response.json().checks[0].name).toBe('database');
  });

  it('treats thrown checks as failures without leaking stack traces', async () => {
    const app = buildApiServer({
      directory: emptyDirectory,
      allowDemoTenant: true,
      readinessChecks: [
        {
          name: 'flaky',
          required: true,
          run: async () => {
            throw new Error('connection refused at internal-host:5432');
          },
        },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    // The short error message may be included; stack frames must not be.
    expect(response.body).not.toContain('readiness.test');
    expect(response.body).not.toMatch(/\n\s+at /);
  });
});
