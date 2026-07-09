import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ImportsResponse {
  dataSource: string;
  batches: Array<{
    id: string;
    importKind: string;
    fileName: string | undefined;
    rowCount: number | undefined;
    status: string;
    errorSummary: string | undefined;
    startedAt: string;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  parsing: 'Tolkas',
  validating: 'Valideras',
  mapping: 'Mappas',
  loaded: 'Inläst',
  failed: 'Misslyckad',
  partially_loaded: 'Delvis inläst',
  rejected: 'Avvisad',
};

export default async function ImporterPage() {
  await requireSession();
  const result = await apiGet<ImportsResponse>('/imports');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Importer</h1>
      <p>
        Importera verksamhetsdata från kommunens källsystem (CSV/XLSX). Varje import valideras och
        förhandsgranskas innan den läses in, kan ångras före inläsning och får full spårbarhet.
      </p>
      <p>
        <a
          href="/importer/new"
          style={{
            display: 'inline-block',
            background: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius)',
            textDecoration: 'none',
          }}
        >
          Starta ny import
        </a>
      </p>
      <ApiStateGuard result={result} />
      {result.kind === 'ok' ? (
        result.data.batches.length === 0 ? (
          <NoDataYet what="inga importer" />
        ) : (
          <Card title={`Importbatcher (${result.data.batches.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Fil</th>
                  <th style={{ padding: 'var(--space-2)' }}>Typ</th>
                  <th style={{ padding: 'var(--space-2)' }}>Rader</th>
                  <th style={{ padding: 'var(--space-2)' }}>Startad</th>
                  <th style={{ padding: 'var(--space-2)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.data.batches.map((batch) => (
                  <tr key={batch.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <a href={`/importer/${batch.id}`}>{batch.fileName ?? batch.id.slice(0, 8)}</a>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{batch.importKind}</td>
                    <td style={{ padding: 'var(--space-2)' }}>{batch.rowCount ?? '—'}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {batch.startedAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <StatusBadge
                        status={STATUS_LABELS[batch.status] ?? batch.status}
                        tone={
                          batch.status === 'loaded'
                            ? 'success'
                            : ['failed', 'rejected'].includes(batch.status)
                              ? 'danger'
                              : 'info'
                        }
                      />
                    </td>
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
