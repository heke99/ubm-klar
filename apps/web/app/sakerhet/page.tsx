import { Card, StatusBadge } from '../../design-system/components';

export const dynamic = 'force-dynamic';

/** Säkerhet: anomalier, incidenter, NIS2-beredskap, SIEM. */
export default function SakerhetPage() {
  return (
    <>
      <h1>Säkerhet</h1>
      <Card title="Säkerhets- och integritetsanomalier">
        <ul>
          <li>
            Nekade behörighetsförsök i följd — <StatusBadge status="0 öppna" tone="success" />
          </li>
          <li>
            Rolländringar i hög takt — <StatusBadge status="0 öppna" tone="success" />
          </li>
          <li>
            Kontoändringar nära utbetalning — <StatusBadge status="Bevakas" tone="info" />
          </li>
          <li>
            Break-glass utan incidentreferens — <StatusBadge status="0 öppna" tone="success" />
          </li>
        </ul>
      </Card>
      <Card title="NIS2-beredskap">
        <ul>
          <li>Cyberriskregister med ägare, sannolikhet/konsekvens och åtgärdsplan</li>
          <li>Säkerhetskontroller med ramverksreferens och verifieringsbevis</li>
          <li>Leverantörsriskregister (kritikalitet, DPA, säkerhetsgranskning, exitplan)</li>
          <li>Kontinuitetsplaner med RTO/RPO och testresultat</li>
          <li>Incidenthantering med tidslinje och myndighetsrapportering</li>
          <li>Säkerhetsövningar (tabletop, återläsning, failover, phishing)</li>
        </ul>
      </Card>
      <Card title="SIEM-export">
        <p>
          Tekniska händelser (utan personuppgifter) kan exporteras till kommunens SIEM i JSON
          Lines/CEF/syslog. Varje händelse passerar no-PII-kontrollen innan export.
        </p>
      </Card>
    </>
  );
}
