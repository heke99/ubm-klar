import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@ubm-klar/auth';

export const dynamic = 'force-dynamic';

/** Streams the export package from the API (auth + tenant forwarded; download audited server-side). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headerStore = await headers();
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';

  const response = await fetch(
    `${apiBase}/ubm/export-proposals/${encodeURIComponent(id)}/download`,
    {
      headers: {
        host: headerStore.get('host') ?? '',
        ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}),
      },
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    return NextResponse.json(
      { error: 'download_failed', status: response.status },
      { status: response.status },
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': response.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
