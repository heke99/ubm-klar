import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness endpoint for the web app (no auth, no tenant resolution, no PII). */
export async function GET() {
  return NextResponse.json({ service: 'web', status: 'ok', piiSafe: true });
}
