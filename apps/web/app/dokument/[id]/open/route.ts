import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@ubm-klar/auth';

export const dynamic = 'force-dynamic';

/** Opens/downloads a document via the API (reason forwarded; access logged server-side). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await request.formData();
  const reason = String(form.get('reason') ?? '');
  const headerStore = await headers();
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';

  const response = await fetch(`${apiBase}/documents/${encodeURIComponent(id)}/open`, {
    method: 'POST',
    headers: {
      host: headerStore.get('host') ?? '',
      'content-type': 'application/json',
      ...(session ? { cookie: `${SESSION_COOKIE_NAME}=${session}` } : {}),
    },
    body: JSON.stringify(reason ? { reason } : {}),
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return NextResponse.redirect(
      new URL(
        `/dokument/${id}?error=${encodeURIComponent(body.message ?? 'open_failed')}`,
        request.url,
      ),
      303,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': response.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
