import { Card } from '../../design-system/components';

export const dynamic = 'force-static';

/** Revision och loggar: hash-kedjad revisionslogg och dataåtkomstlogg. */
export default function RevisionPage() {
  return (
    <>
      <h1>Revision och loggar</h1>
      <Card title="Revisionslogg (audit log)">
        <p>
          Alla väsentliga händelser loggas i en append-only, hash-kedjad revisionslogg:
          personsökningar, öppnade poster, dokumentåtkomst, känsliga visningar, exportförslag,
          godkännanden, UBM-exporter, regeländringar, mottagarändringar, support- och
          break-glass-sessioner, migreringar, gallring och AI-förslag. Kedjan kan verifieras och
          manipulation upptäcks.
        </p>
      </Card>
      <Card title="Dataåtkomstlogg">
        <p>
          Varje åtkomst till personuppgifter loggas med vem, vad, när, i vilken roll, i vilket
          ärende och med vilket skäl. Skäl krävs alltid för medicinska uppgifter, skyddad
          identitet, barns uppgifter och känsliga fält.
        </p>
      </Card>
      <Card title="Beviskedja">
        <p>
          Kontrollärenden, UBM-exporter och riskflaggor bär en hash-länkad beviskedja: källposter,
          importbatchar, regelversioner, schemaversioner, granskningsbeslut, godkännanden,
          exportpaket och kvittenser — spårbart i efterhand med kontrollsummor.
        </p>
      </Card>
    </>
  );
}
