import { evaluateUbmEligibility, cleanEligibilityInput } from '@ubm-klar/ubm-eligibility-engine';
import { BlockedExplanation, Card, StatusBadge } from '../../design-system/components';

export const dynamic = 'force-static';

/** Exportförslag: behörighetsbedömning med "varför är detta blockerat". */
export default function ExportforslagPage() {
  const allowed = evaluateUbmEligibility(cleanEligibilityInput());
  const blocked = evaluateUbmEligibility({
    ...cleanEligibilityInput(),
    dataLineageComplete: false,
    involvesHealthMedicalData: true,
  });
  return (
    <>
      <h1>Exportförslag</h1>
      <Card title="Förslag UBM-2026-0001 (demo)">
        <p>
          Status:{' '}
          <StatusBadge
            status={allowed.outcome === 'send_allowed' ? 'Klart att skicka' : allowed.outcome}
            tone="success"
          />
        </p>
        <p>
          Alla kontroller är godkända. Paketet skapas med hash och signaturplatshållare, kräver
          fyra-ögon-godkännande och levereras via godkänd kanal.
        </p>
      </Card>
      <Card title="Förslag UBM-2026-0002 (demo, blockerat)">
        <p>
          Status: <StatusBadge status={blocked.outcome} tone="danger" />
        </p>
        <BlockedExplanation blockers={blocked.blockers} />
        <p>Åtgärder som krävs innan export:</p>
        <ul>
          {blocked.outcomes
            .filter((o) => o !== 'do_not_send')
            .map((outcome) => (
              <li key={outcome}>{outcome}</li>
            ))}
        </ul>
      </Card>
    </>
  );
}
