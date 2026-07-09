import { Card } from '../../design-system/components';
import { PRODUCT_NAME } from '@ubm-klar/shared-types';

export const dynamic = 'force-static';

/** Tillgänglighetsredogörelse enligt lagen om tillgänglighet till digital offentlig service. */
export default function TillganglighetPage() {
  return (
    <>
      <h1>Tillgänglighetsredogörelse</h1>
      <Card title={`Tillgänglighet i ${PRODUCT_NAME}`}>
        <p>
          {PRODUCT_NAME} ska kunna användas av alla, oavsett funktionsförmåga. Målet är att uppfylla
          WCAG 2.1 nivå AA och EN 301 549.
        </p>
        <h3>Så här uppfyller tjänsten kraven</h3>
        <ul>
          <li>All funktionalitet kan nås med enbart tangentbord, med synlig fokusmarkering.</li>
          <li>
            Sidorna har logisk rubrikstruktur, landmärken och en hopp-länk till huvudinnehållet.
          </li>
          <li>
            Tabeller har rubrikceller och beskrivningar; formulär har etiketter och tydliga
            felmeddelanden.
          </li>
          <li>Statusar förmedlas med både färg och text; kontraster uppfyller AA.</li>
          <li>Alla vyer har tydliga laddnings-, tomt-, fel- och behörighetslägen.</li>
          <li>Gränssnittet är på svenska med klarspråk.</li>
        </ul>
        <h3>Rapportera brister</h3>
        <p>
          Om du upptäcker tillgänglighetsbrister, kontakta er systemförvaltare som vidarebefordrar
          till leverantören. Du kan även kontakta tillsynsmyndigheten (Digg) om du inte är nöjd med
          hanteringen.
        </p>
        <p>Denna redogörelse uppdaterades 2026-07-07.</p>
      </Card>
    </>
  );
}
