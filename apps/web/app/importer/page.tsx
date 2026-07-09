import { Card, StatusBadge } from '../../design-system/components';

export const dynamic = 'force-static';

/** Importer: källsystem, importstatus och valideringsrapporter. */
export default function ImporterPage() {
  const batches = [
    {
      id: 'IMP-1042',
      kind: 'Betalningsfil (BGMAX)',
      rows: 1240,
      status: 'Inläst',
      tone: 'success' as const,
    },
    {
      id: 'IMP-1041',
      kind: 'LSS-beslut (CSV)',
      rows: 480,
      status: 'Delvis inläst',
      tone: 'warning' as const,
    },
    {
      id: 'IMP-1040',
      kind: 'EB-ansökningar (Excel)',
      rows: 300,
      status: 'Avvisad',
      tone: 'danger' as const,
    },
  ];
  return (
    <>
      <h1>Importer</h1>
      <Card title="Stödda kanaler">
        <p>
          CSV, Excel, JSON, XML, REST API, SFTP, SQL (läsbehörighet), manuell uppladdning och
          schemalagd import. Mappningsguiden föreslår fältmappningar; integrationsmallar finns för
          vanliga kommunala källsystem. Framtida Inera/GIF- och UBM-transportadaptrar är förberedda
          som abstraktioner.
        </p>
      </Card>
      <Card title="Senaste importer (demo)">
        <table>
          <caption>Importbatchar</caption>
          <thead>
            <tr>
              <th scope="col">Batch</th>
              <th scope="col">Typ</th>
              <th scope="col">Rader</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id}>
                <td>{batch.id}</td>
                <td>{batch.kind}</td>
                <td>{batch.rows}</td>
                <td>
                  <StatusBadge status={batch.status} tone={batch.tone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Efter import körs automatiskt">
        <ol>
          <li>Normalisering och fältmappning</li>
          <li>System-of-record-länkning och datalinje</li>
          <li>Datakvalitetskontroller (26 kontroller)</li>
          <li>Regelmotor och riskflaggor</li>
          <li>Kontrollärenden vid behov, därefter rapporter</li>
        </ol>
      </Card>
    </>
  );
}
