import { describe, expect, it } from 'vitest';
import { MissingEnvVarError, readEnv, redactEnv, type EnvVarSpec } from './env';

const specs: EnvVarSpec[] = [
  { name: 'API_URL', required: true, secret: false, description: 'API url' },
  { name: 'SERVICE_KEY', required: false, secret: true, description: 'service key' },
];

describe('readEnv', () => {
  it('throws with the names of missing required variables', () => {
    expect(() => readEnv(specs, {})).toThrow(MissingEnvVarError);
  });

  it('reads present values', () => {
    const values = readEnv(specs, { API_URL: 'http://x', SERVICE_KEY: 's3cr3t' });
    expect(values).toEqual({ API_URL: 'http://x', SERVICE_KEY: 's3cr3t' });
  });
});

describe('redactEnv', () => {
  it('redacts secrets only', () => {
    const values = { API_URL: 'http://x', SERVICE_KEY: 's3cr3t' };
    expect(redactEnv(values, specs)).toEqual({
      API_URL: 'http://x',
      SERVICE_KEY: '***redacted***',
    });
  });
});
