import { NextResponse, type NextRequest } from 'next/server';
import { validateTenantDomain } from '@ubm-klar/shared-types';

/**
 * Strict tenant gate. Unknown or forbidden domains fail closed with 421.
 * localhost is allowed only for local development/demo (never a production host).
 *
 * Full tenant resolution (directory lookup, verification, config) happens in the
 * backend; the middleware is the first line of defence for domain spoofing.
 */
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  const bareHost = host.split(':')[0] ?? '';

  if (bareHost === 'localhost' || bareHost === '127.0.0.1') {
    return NextResponse.next();
  }

  const validation = validateTenantDomain(bareHost);
  if (!validation.valid) {
    return new NextResponse(
      JSON.stringify({
        error: 'unknown_tenant',
        message: 'Okänd eller otillåten domän. Kontakta er systemadministratör.',
      }),
      { status: 421, headers: { 'content-type': 'application/json' } },
    );
  }
  return NextResponse.next();
}

export const config = {
  // /health is exempt: infrastructure probes have no tenant Host header.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};
