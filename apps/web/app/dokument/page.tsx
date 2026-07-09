import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../design-system/components';
import { apiGet, apiSend } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

async function uploadDocumentAction(formData: FormData) {
  'use server';
  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) redirect('/dokument?error=missing_file');
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await apiSend<{ id: string }>('POST', '/documents', {
    fileName: file.name,
    contentBase64: buffer.toString('base64'),
    mimeType: file.type || 'application/octet-stream',
    bucketKey: String(formData.get('bucketKey') ?? 'documents-lss'),
    documentType: String(formData.get('documentType') ?? 'other'),
    documentClass: String(formData.get('documentClass') ?? 'standard'),
  });
  if (result.kind !== 'ok') redirect(`/dokument?error=${result.kind}`);
  redirect(`/dokument/${result.data.id}`);
}

interface DocumentsResponse {
  dataSource: string;
  documents: Array<{
    id: string;
    fileName: string;
    documentType: string;
    documentClass: string;
    malwareScanStatus: string;
    isRedactedVersion: boolean;
    uploadedAt: string;
  }>;
}

const CLASS_LABELS: Record<string, string> = {
  standard: 'Standard',
  sensitive: 'Känslig',
  medical: 'Medicinsk',
  protected_identity: 'Skyddad identitet',
  children: 'Barn/minderårig',
  disclosure: 'Utlämnande',
  archive: 'Arkiv',
};

export default async function DokumentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const result = await apiGet<DocumentsResponse>('/documents');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Dokument</h1>
      <p>
        Dokumentvalvet lagrar handlingar med klassificering, virusskanning och maskning. Öppning av
        känsliga dokument kräver angivet skäl och loggas alltid i dataåtkomstloggen.
      </p>
      {params.error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Uppladdningen misslyckades ({params.error}).
        </p>
      ) : null}
      <Card title="Ladda upp dokument">
        <form
          action={uploadDocumentAction}
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="file" name="file" required />
          <label>
            Bucket{' '}
            <select name="bucketKey">
              <option value="documents-lss">LSS</option>
              <option value="documents-economic-assistance">Ekonomiskt bistånd</option>
              <option value="documents-ubm">UBM</option>
            </select>
          </label>
          <label>
            Typ{' '}
            <select name="documentType">
              <option value="decision">Beslut</option>
              <option value="certificate">Intyg</option>
              <option value="application">Ansökan</option>
              <option value="other">Övrigt</option>
            </select>
          </label>
          <label>
            Klassificering{' '}
            <select name="documentClass">
              <option value="standard">Standard/intern</option>
              <option value="sensitive">Känslig personuppgift</option>
              <option value="medical">Medicinsk/hälsa</option>
              <option value="protected_identity">Skyddad identitet</option>
              <option value="children">Barn/minderårig</option>
            </select>
          </label>
          <button type="submit">Ladda upp (virusskannas)</button>
        </form>
      </Card>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.documents.length === 0 ? (
          <NoDataYet what="inga dokument" />
        ) : (
          <Card title={`Dokument (${result.data.documents.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Filnamn</th>
                  <th style={{ padding: 'var(--space-2)' }}>Typ</th>
                  <th style={{ padding: 'var(--space-2)' }}>Klass</th>
                  <th style={{ padding: 'var(--space-2)' }}>Virusskanning</th>
                  <th style={{ padding: 'var(--space-2)' }}>Uppladdad</th>
                </tr>
              </thead>
              <tbody>
                {result.data.documents.map((doc) => (
                  <tr key={doc.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <a href={`/dokument/${doc.id}`}>{doc.fileName}</a>
                      {doc.isRedactedVersion ? ' (maskad kopia)' : ''}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{doc.documentType}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={CLASS_LABELS[doc.documentClass] ?? doc.documentClass}
                        tone={
                          ['medical', 'protected_identity', 'children'].includes(doc.documentClass)
                            ? 'danger'
                            : doc.documentClass === 'sensitive'
                              ? 'warning'
                              : 'info'
                        }
                      />
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={doc.malwareScanStatus}
                        tone={
                          doc.malwareScanStatus === 'clean'
                            ? 'success'
                            : doc.malwareScanStatus === 'infected'
                              ? 'danger'
                              : 'warning'
                        }
                      />
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{doc.uploadedAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : null}
    </div>
  );
}
