import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

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

export default async function DokumentPage() {
  await requireSession();
  const result = await apiGet<DocumentsResponse>('/documents');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Dokument</h1>
      <p>
        Dokumentvalvet lagrar handlingar med klassificering, virusskanning och maskning. Öppning av
        känsliga dokument kräver angivet skäl och loggas alltid i dataåtkomstloggen.
      </p>
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
