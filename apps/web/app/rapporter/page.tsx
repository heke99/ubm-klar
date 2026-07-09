import { Card } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';
import { ApiStateGuard } from '../../components/page-states';

export const dynamic = 'force-dynamic';

interface ReportsResponse {
  reports: Array<{ key: string; titleSv: string; permission: string }>;
}

/** Rapporter över verkliga data, exporterbara som CSV/XLSX/JSON. */
export default async function RapporterPage() {
  await requireSession();
  const result = await apiGet<ReportsResponse>('/reports');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Rapporter</h1>
      <Card title="Tillgängliga rapporter">
        <p>
          Rapporterna bygger på kommunens verkliga data och respekterar behörighetsmodellen —
          rapporter din roll inte får se kan inte köras. Export finns som CSV, XLSX och JSON. Varje
          rapportkörning loggas i revisionsloggen.
        </p>
        <ApiStateGuard result={result} />
        {result.kind === 'ok' ? (
          <ul>
            {result.data.reports.map((report) => (
              <li key={report.key} style={{ marginBottom: 6 }}>
                <a href={`/rapporter/${report.key}`}>{report.titleSv}</a>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
