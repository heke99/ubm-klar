import { Card, StatusBadge } from '../../design-system/components';
import { requireSession } from '../../lib/require-session';

export const dynamic = 'force-dynamic';

/** Arkiv: klassificering, gallring, rättsliga undantag, e-arkiv. */
export default async function ArkivPage() {
  await requireSession();
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Arkiv</h1>
      <Card title="Gallring och bevarande">
        <table>
          <caption>Standardgallringsregler (konfigureras per kommun)</caption>
          <thead>
            <tr>
              <th scope="col">Klassificering</th>
              <th scope="col">Utlösande händelse</th>
              <th scope="col">Frist</th>
              <th scope="col">Åtgärd</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>EB-ärenden</td>
              <td>Ärende avslutat</td>
              <td>5 år</td>
              <td>
                <StatusBadge status="Gallras" tone="info" />
              </td>
            </tr>
            <tr>
              <td>LSS-beslut</td>
              <td>Beslut upphört</td>
              <td>10 år</td>
              <td>
                <StatusBadge status="Arkiveras" tone="info" />
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          Rättsliga undantag (legal holds) stoppar alltid gallring. Gallringsbeslut kräver
          fyra-ögon-godkännande och loggas i arkivets revisionsspår.
        </p>
      </Card>
      <Card title="E-arkivuttag">
        <p>
          Uttag paketeras med manifest och kontrollsummor (FGS-paket/OAIS SIP/zip+manifest),
          verifieras mot manifestet och kräver arkivbehörighet samt godkännande.
        </p>
      </Card>
    </div>
  );
}
