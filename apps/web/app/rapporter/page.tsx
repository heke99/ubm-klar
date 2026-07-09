import { Card } from '../../design-system/components';
import { requireSession } from '../../lib/require-session';

export const dynamic = 'force-dynamic';

/** Rapporter: exporterbara lednings- och verksamhetsrapporter över verkliga data. */
export default async function RapporterPage() {
  await requireSession();

  const reports = [
    { href: '/rapporter/ubm-beredskap', label: 'UBM-beredskapsrapport' },
    { href: '/rapporter/ubm-forfragningar', label: 'Öppna UBM-förfrågningar och svarsfrister' },
    { href: '/rapporter/exportforslag', label: 'Exportförslag per status och blockeringsorsaker' },
    { href: '/rapporter/lss-risk', label: 'LSS-betalningsrisker' },
    { href: '/rapporter/eb-risk', label: 'Ekonomiskt bistånd — betalningsrisker' },
    { href: '/rapporter/kontrollarenden', label: 'Kontrollärenden' },
    { href: '/rapporter/datakvalitet', label: 'Datakvalitet och importfel' },
    { href: '/rapporter/atkomst', label: 'Revisions- och dataåtkomstrapport' },
    { href: '/rapporter/go-live', label: 'Go-live-beredskap' },
    { href: '/rapporter/pilot', label: 'Pilotutfall' },
  ];

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Rapporter</h1>
      <Card title="Tillgängliga rapporter">
        <p>
          Rapporterna bygger på kommunens verkliga data och respekterar behörighetsmodellen —
          uppgifter du inte har rätt att se ingår inte. Export finns som CSV, XLSX och JSON.
        </p>
        <ul>
          {reports.map((report) => (
            <li key={report.href}>
              <a href={report.href}>{report.label}</a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
