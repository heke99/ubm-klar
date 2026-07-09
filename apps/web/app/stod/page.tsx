import { Card } from '../../design-system/components';
import { requireSession } from '../../lib/require-session';

export const dynamic = 'force-dynamic';

/** Support och kontakt: supportmodell utan personuppgifter. */
export default async function StodPage() {
  await requireSession();
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Support och kontakt</h1>
      <Card title="Så fungerar supporten">
        <ul>
          <li>Leverantörens support ser aldrig personuppgifter — endast teknisk status.</li>
          <li>
            Utökad felsökning kräver en tidsbegränsad JIT-session som kommunen godkänner, med
            ärendereferens och begränsat scope. Alla åtgärder loggas.
          </li>
          <li>
            Break-glass (nödåtkomst) är separat, kräver incidentreferens, är strikt tidsbegränsad
            och efterhandsgranskas alltid.
          </li>
        </ul>
      </Card>
      <Card title="Kontaktvägar">
        <ul>
          <li>
            Supportärenden: via kommunens systemadministratör till leverantörens supportportal
          </li>
          <li>Säkerhetsincidenter: incidentkontakt enligt incidentrunbooken (dygnet runt)</li>
          <li>Dataskyddsfrågor: kommunens DPO samt leverantörens dataskyddskontakt</li>
        </ul>
        <p>
          Skicka aldrig personnummer, namn eller andra personuppgifter i supportärenden. Använd
          ärendenummer och tekniska referenser.
        </p>
      </Card>
    </div>
  );
}
