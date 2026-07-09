import type { FastifyInstance } from 'fastify';

/**
 * Readiness endpoint: /ready answers 200 only when every configured dependency
 * is reachable and valid. Missing dependencies fail closed with the failing
 * check named (no internals leaked).
 */

export interface ReadinessCheck {
  name: string;
  required: boolean;
  run: () => Promise<{ ok: boolean; detail?: string }>;
}

export function registerReadiness(app: FastifyInstance, checks: ReadinessCheck[]): void {
  app.get('/ready', async (_request, reply) => {
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          const result = await check.run();
          return {
            name: check.name,
            required: check.required,
            ok: result.ok,
            detail: result.detail,
          };
        } catch (error) {
          return {
            name: check.name,
            required: check.required,
            ok: false,
            detail: error instanceof Error ? error.message.slice(0, 120) : 'check failed',
          };
        }
      }),
    );
    const failedRequired = results.filter((result) => result.required && !result.ok);
    const status = failedRequired.length === 0 ? 200 : 503;
    return reply.status(status).send({
      ready: failedRequired.length === 0,
      checks: results.map((result) => ({
        name: result.name,
        ok: result.ok,
        required: result.required,
        ...(result.ok ? {} : { detail: result.detail }),
      })),
    });
  });
}
