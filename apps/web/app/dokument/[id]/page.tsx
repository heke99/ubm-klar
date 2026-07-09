import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface DocumentDetail {
  document: {
    id: string;
    fileName: string;
    mimeType: string;
    documentType: string;
    documentClass: string;
    fileSizeBytes: number;
    fileHashSha256: string;
    malwareScanStatus: string;
    isRedactedVersion: boolean;
    originalDocumentId: string | undefined;
    redactionStatus: string | undefined;
    uploadedAt: string;
  };
  redactionJobs: Array<{ id: string; status: string; redactedDocumentId: string | null }>;
  reasonRequiredToOpen: boolean;
}

async function planRedactionAction(formData: FormData) {
  'use server';
  const id = String(formData.get('documentId'));
  await apiSend('POST', `/documents/${id}/redaction/plan`, {});
  redirect(`/dokument/${id}`);
}

async function applyRedactionAction(formData: FormData) {
  'use server';
  const id = String(formData.get('documentId'));
  await apiSend('POST', `/documents/${id}/redaction/apply`, {
    jobId: String(formData.get('jobId')),
  });
  redirect(`/dokument/${id}`);
}

export default async function DokumentDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const result = await apiGet<DocumentDetail>(`/documents/${id}`);

  if (result.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Dokument</h1>
        <ApiStateGuard result={result} />
      </div>
    );
  }
  const { document, redactionJobs, reasonRequiredToOpen } = result.data;

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>{document.fileName}</h1>
      <p>
        Klass:{' '}
        <StatusBadge
          status={document.documentClass}
          tone={reasonRequiredToOpen ? 'danger' : 'info'}
        />{' '}
        · Virusskanning:{' '}
        <StatusBadge
          status={document.malwareScanStatus}
          tone={document.malwareScanStatus === 'clean' ? 'success' : 'warning'}
        />{' '}
        ·{Math.round(document.fileSizeBytes / 1024)} kB · sha256{' '}
        <code>{document.fileHashSha256.slice(0, 16)}…</code>
      </p>
      {document.isRedactedVersion ? (
        <p>
          <StatusBadge status="Maskerad kopia" tone="success" /> Original:{' '}
          <a href={`/dokument/${document.originalDocumentId}`}>visa</a>
        </p>
      ) : null}

      <Card title="Öppna dokument">
        {reasonRequiredToOpen ? (
          <p>
            Dokumentet är klassat som <strong>{document.documentClass}</strong>: skäl krävs för att
            öppna det och åtkomsten loggas alltid i dataåtkomstloggen.
          </p>
        ) : (
          <p>Åtkomsten loggas alltid i dataåtkomstloggen.</p>
        )}
        <form method="post" action={`/dokument/${document.id}/open`}>
          {reasonRequiredToOpen ? (
            <label>
              Skäl <input name="reason" required style={{ width: 320 }} />
            </label>
          ) : null}{' '}
          <button type="submit">Öppna/ladda ner</button>
        </form>
      </Card>

      {!document.isRedactedVersion ? (
        <Card title="Maskning">
          {redactionJobs.length === 0 ? (
            <form action={planRedactionAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <button type="submit">Planera maskning (personnummer och kontonummer)</button>
            </form>
          ) : (
            <ul>
              {redactionJobs.map((job) => (
                <li key={job.id}>
                  Maskningsjobb{' '}
                  <StatusBadge
                    status={job.status}
                    tone={job.status === 'completed' ? 'success' : 'info'}
                  />
                  {job.status === 'queued' ? (
                    <form
                      action={applyRedactionAction}
                      style={{ display: 'inline', marginLeft: 8 }}
                    >
                      <input type="hidden" name="documentId" value={document.id} />
                      <input type="hidden" name="jobId" value={job.id} />
                      <button type="submit">Genomför och verifiera maskning</button>
                    </form>
                  ) : null}
                  {job.redactedDocumentId ? (
                    <>
                      {' '}
                      · <a href={`/dokument/${job.redactedDocumentId}`}>maskerad kopia</a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Maskerade kopior lagras separat i bucketen documents-redacted. Maskningen verifieras —
            om känsliga mönster finns kvar sparas ingen kopia. Automatisk maskning stöds för
            textdokument; övriga format maskas manuellt.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
