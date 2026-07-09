import { Card, StatusBadge } from '../../design-system/components';
import { apiGet } from '../../lib/api';
import { requireSession } from '../../lib/require-session';

export const dynamic = 'force-dynamic';

interface ApprovalStatus {
  pilot: { allowed: boolean; openRequiredGates: string[]; waivedGates: string[] };
}

/** Pilotläge: vad som ingår, vad som är avstängt och vilka risker som gäller. */
export default async function PilotPage() {
  await requireSession();
  const approval = await apiGet<ApprovalStatus>('/onboarding/approval-status');
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Kundpilotläge</h1>
      <p>
        Den här miljön körs i <strong>kundpilotläge</strong>. Piloten är avsedd för kontrollerad
        utvärdering — den är inte ett produktionsgodkännande.
      </p>
      <Card title="Det här ingår i piloten">
        <ul>
          <li>Inloggning med kommunens SSO (eller godkänd pilotinloggning)</li>
          <li>Rollstyrd åtkomst med behörighetskontroll i backend</li>
          <li>Kontrollerad import av avgränsade datamängder (CSV/XLSX)</li>
          <li>Manuell registrering och handläggning av UBM-förfrågningar</li>
          <li>Lämplighetsprövning, exportförslag och fyra-ögon-godkännande</li>
          <li>Manuell paketering och nedladdning av export</li>
          <li>Beständiga revisions- och dataåtkomstloggar</li>
        </ul>
      </Card>
      <Card title="Det här är avstängt i piloten">
        <ul>
          <li>
            Officiell UBM-överföring <StatusBadge status="Avstängd" tone="warning" /> — ingen
            officiell specifikation, inga credentials, ingen säkerhetsgodkänd transport finns.
          </li>
          <li>
            Återkommande rapportering 2029 <StatusBadge status="Avstängd" tone="warning" />
          </li>
          <li>Automatiska intag (API/e-post) — endast manuell registrering och filuppladdning</li>
        </ul>
      </Card>
      <Card title="Viktiga begränsningar">
        <ul>
          <li>
            Importera inte fullständiga produktionsdata innan PUB-avtal, DPIA och obligatoriska
            beredskapsgrindar är godkända.
          </li>
          <li>All export sker manuellt och kräver godkännande av två olika personer.</li>
          <li>
            Piloten kan avbrytas och data raderas enligt pilotavtalet — exportera inget som inte får
            lämna miljön.
          </li>
          <li>Incidenter rapporteras till kommunens kontaktperson och leverantörens support.</li>
        </ul>
      </Card>
      <Card title="Pilotens godkännandegrindar">
        <p>
          Pilotstart kräver bland annat: skapad tenant, verifierad domän, konfigurerad inloggning,
          konfigurerade roller, PUB-avtal eller uttryckligt beslut om syntetiska data, registrerad
          DPIA-status, genomförd provimport, genomförd UBM-övningsförfrågan, genomförd exportövning,
          verifierade revisions- och dataåtkomstloggar samt överenskommen supportprocess. Status
          följs under <a href="/onboarding">Onboarding</a>.
        </p>
        {approval.kind === 'ok' ? (
          approval.data.pilot.allowed ? (
            <StatusBadge status="Alla pilotgrindar klara" tone="success" />
          ) : (
            <>
              <StatusBadge
                status={`${approval.data.pilot.openRequiredGates.length} pilotgrindar återstår`}
                tone="warning"
              />
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                Återstår: {approval.data.pilot.openRequiredGates.join(', ')}
              </p>
            </>
          )
        ) : null}
      </Card>
    </div>
  );
}
