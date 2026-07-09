import { redirect } from 'next/navigation';
import { Card } from '../../../design-system/components';
import { apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';

export const dynamic = 'force-dynamic';

async function registerAction(formData: FormData) {
  'use server';
  const result = await apiSend<{ id: string }>('POST', '/ubm/notifications', {
    notificationNumber: String(formData.get('notificationNumber') ?? '').trim(),
    receivedAt: String(formData.get('receivedAt') ?? new Date().toISOString().slice(0, 10)),
    domain: String(formData.get('domain') ?? 'unknown'),
    summary: String(formData.get('summary') ?? '').trim(),
  });
  if (result.kind !== 'ok') redirect(`/underrattelser/new?error=${result.kind}`);
  redirect(`/underrattelser/${result.data.id}`);
}

export default async function NyUnderrattelsePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const params = await searchParams;

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
      <h1>Registrera underrättelse</h1>
      <p>
        Registrera en inkommande underrättelse från Utbetalningsmyndigheten manuellt (t.ex. mottagen
        per brev eller säker e-post). Officiell digital kanal finns inte.
      </p>
      {params.error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Underrättelsen kunde inte registreras
          {params.error === 'forbidden' ? ' — behörighet saknas' : ''}.
        </p>
      ) : null}
      <Card title="Underrättelsens uppgifter">
        <form action={registerAction}>
          <label htmlFor="notificationNumber" style={{ display: 'block', margin: '8px 0 4px' }}>
            Underrättelsenummer *
          </label>
          <input
            id="notificationNumber"
            name="notificationNumber"
            required
            style={{ width: '100%', padding: 8 }}
          />

          <label htmlFor="receivedAt" style={{ display: 'block', margin: '8px 0 4px' }}>
            Mottagen datum *
          </label>
          <input
            id="receivedAt"
            name="receivedAt"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />

          <label htmlFor="domain" style={{ display: 'block', margin: '8px 0 4px' }}>
            Verksamhetsområde
          </label>
          <select id="domain" name="domain" style={{ width: '100%', padding: 8 }}>
            <option value="unknown">Okänt</option>
            <option value="lss">LSS</option>
            <option value="economic_assistance">Ekonomiskt bistånd</option>
          </select>

          <label htmlFor="summary" style={{ display: 'block', margin: '8px 0 4px' }}>
            Sammanfattning av innehållet *
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={4}
            required
            style={{ width: '100%', padding: 8 }}
          />

          <button
            type="submit"
            style={{
              marginTop: 12,
              background: 'var(--color-primary)',
              color: 'var(--color-primary-contrast)',
              border: 0,
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
          >
            Registrera underrättelse
          </button>
        </form>
      </Card>
    </div>
  );
}
