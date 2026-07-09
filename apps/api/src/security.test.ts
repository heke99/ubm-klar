import { describe, expect, it } from 'vitest';
import type { TenantDirectory } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';

/** Security hardening: headers, rate limits, safe errors. */

const emptyDirectory: TenantDirectory = { lookupByDomain: async () => undefined };

describe('API security hardening', () => {
  it('adds security headers to every response', async () => {
    const app = buildApiServer({ directory: emptyDirectory, allowDemoTenant: true });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS on production-like servers', async () => {
    const app = buildApiServer({
      directory: emptyDirectory,
      allowDemoTenant: false,
      isProductionLike: true,
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['strict-transport-security']).toContain('max-age=');
  });

  it('rate limits sensitive route classes', async () => {
    const app = buildApiServer({ directory: emptyDirectory, allowDemoTenant: true });
    let limited = false;
    for (let index = 0; index < 40; index++) {
      const response = await app.inject({
        method: 'POST',
        url: '/persons/reveal-field',
        headers: { host: 'localhost' },
        payload: {},
      });
      if (response.statusCode === 429) {
        limited = true;
        expect(response.headers['retry-after']).toBeTruthy();
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it('hides internal errors behind a correlation id (no stack traces)', async () => {
    const app = buildApiServer({ directory: emptyDirectory, allowDemoTenant: true });
    app.get('/boom', async () => {
      throw new Error('secret internal detail with stack');
    });
    const response = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error).toBe('internal_error');
    expect(body.correlationId).toBeTruthy();
    expect(response.body).not.toContain('secret internal detail');
    expect(response.body).not.toContain('at ');
  });

  it('enforces the request body size limit', async () => {
    const app = buildApiServer({ directory: emptyDirectory, allowDemoTenant: true });
    const response = await app.inject({
      method: 'POST',
      url: '/ubm/eligibility',
      headers: {
        host: 'localhost',
        'content-type': 'application/json',
        'content-length': String(50 * 1024 * 1024),
      },
      payload: '',
    });
    expect([400, 413]).toContain(response.statusCode);
  });
});
