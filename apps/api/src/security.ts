import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sanitizeTechnicalLogEvent } from '@ubm-klar/data-access-log';

/**
 * API security hardening: response headers, rate limiting and safe error
 * handling (no stack traces, no PII, always a correlation id).
 */

export function registerSecurityHeaders(app: FastifyInstance, isProductionLike: boolean): void {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (isProductionLike) {
      reply.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    }
  });
}

type RateClass = 'auth' | 'upload' | 'download' | 'reveal' | 'api';

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const RATE_LIMITS: Record<RateClass, RateLimitRule> = {
  auth: { limit: 20, windowMs: 60_000 },
  upload: { limit: 30, windowMs: 60_000 },
  download: { limit: 60, windowMs: 60_000 },
  reveal: { limit: 30, windowMs: 60_000 },
  api: { limit: 600, windowMs: 60_000 },
};

function classify(request: FastifyRequest): RateClass {
  const url = request.url.split('?')[0] ?? '';
  if (url.startsWith('/auth') || url === '/login') return 'auth';
  if (
    request.method === 'POST' &&
    (url === '/documents' || url === '/imports' || url.endsWith('/package'))
  ) {
    return 'upload';
  }
  if (url.endsWith('/download') || url.endsWith('/open') || url.startsWith('/reports/')) {
    return 'download';
  }
  if (url.endsWith('/reveal-field')) return 'reveal';
  return 'api';
}

/** Sliding-window in-process rate limiter (per instance; front proxies add global limits). */
export function registerRateLimiter(app: FastifyInstance): void {
  const buckets = new Map<string, number[]>();

  // Periodic cleanup so the map cannot grow unboundedly.
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 120_000;
    for (const [key, timestamps] of buckets) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length === 0) buckets.delete(key);
      else buckets.set(key, kept);
    }
  }, 60_000);
  cleanup.unref?.();

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    const rateClass = classify(request);
    const rule = RATE_LIMITS[rateClass];
    const key = `${request.ip}:${rateClass}`;
    const now = Date.now();
    const timestamps = (buckets.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.limit) {
      reply.header('retry-after', Math.ceil(rule.windowMs / 1000));
      return reply.status(429).send({
        error: 'rate_limited',
        message: 'För många anrop — försök igen om en stund.',
      });
    }
    timestamps.push(now);
    buckets.set(key, timestamps);
  });
}

/** Safe error handler: correlation id out, technical detail only server-side. */
export function registerSafeErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode) || 500
        : 500;

    // Server-side technical log (no PII — message truncated and scanned).
    try {
      const event = sanitizeTechnicalLogEvent({
        level: 'error',
        code: 'API_ERROR',
        message: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        context: {
          correlationId: request.correlationId,
          method: request.method,
          route: request.url.split('?')[0]?.slice(0, 100),
          statusCode,
        },
      });
      console.error(JSON.stringify(event));
    } catch {
      console.error(
        JSON.stringify({
          level: 'error',
          code: 'API_ERROR_REDACTED',
          correlationId: request.correlationId,
        }),
      );
    }

    // Client gets a generic message + correlation id — never stack traces or details.
    if (statusCode >= 500) {
      return reply.status(statusCode).send({
        error: 'internal_error',
        message: 'Ett tekniskt fel inträffade. Ange referensnumret vid kontakt med support.',
        correlationId: request.correlationId,
      });
    }
    return reply.status(statusCode).send({
      error: 'request_failed',
      message: error instanceof Error ? error.message.slice(0, 200) : 'Begäran misslyckades.',
      correlationId: request.correlationId,
    });
  });
}
