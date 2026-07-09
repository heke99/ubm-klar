import 'server-only';

/**
 * In-process rate limiter for the web auth routes (login/callback/dev-login).
 * Front proxies add global limits; this is the application-level backstop.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const timestamps = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  buckets.set(key, timestamps);
  if (buckets.size > 10_000) buckets.clear(); // hard memory cap
  return true;
}

export function clientKey(headers: Headers, route: string): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${forwarded ?? 'local'}:${route}`;
}
