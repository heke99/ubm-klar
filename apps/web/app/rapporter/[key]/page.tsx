import { Card } from '../../../design-system/components';
import { apiGet } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard, NoDataYet } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface ReportResponse {
  key: string;
  titleSv: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}

export default async function RapportPage({ params }: { params: Promise<{ key: string }> }) {
  await requireSession();
  const { key } = await params;
  const report = await apiGet<ReportResponse>(`/reports/${encodeURIComponent(key)}`);

  if (report.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Rapport</h1>
        <ApiStateGuard result={report} />
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>{report.data.titleSv}</h1>
      <p>
        Export: <a href={`/rapporter/${key}/export?format=csv`}>CSV</a> ·{' '}
        <a href={`/rapporter/${key}/export?format=xlsx`}>XLSX</a> ·{' '}
        <a href={`/rapporter/${key}/export?format=json`}>JSON</a>
      </p>
      <Card title={`Resultat (${report.data.rows.length} rader)`}>
        {report.data.rows.length === 0 ? (
          <NoDataYet what="inga rader i rapporten" />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                  {report.data.columns.map((column) => (
                    <th key={column.key} style={{ padding: 'var(--space-2)' }}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.data.rows.map((row, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {report.data.columns.map((column) => (
                      <td key={column.key} style={{ padding: 'var(--space-2)' }}>
                        {String(row[column.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
