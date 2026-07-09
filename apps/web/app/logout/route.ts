import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@ubm-klar/auth';

export const dynamic = 'force-dynamic';

function logout(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login?loggedout=1', request.url), 303);
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

export async function POST(request: NextRequest) {
  return logout(request);
}

export async function GET(request: NextRequest) {
  return logout(request);
}
