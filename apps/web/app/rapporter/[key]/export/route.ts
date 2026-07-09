import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@ubm-klar/auth';

export const dynamic = 'force-dynamic';

/** Streams a report export from the API (auth + tenant forwarded; audited server-side). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  const headerStore = await headers();
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';

  const response = await fetch(
    `${apiBase}/reports/${encodeURIComponent(key)}?format=${encodeURIComponent(format)}`,
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
      { error: 'export_failed', status: response.status },
      { status: response.status },
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        response.headers.get('content-disposition') ?? `attachment; filename="${key}.${format}"`,
    },
  });
}
