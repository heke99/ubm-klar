import { Card, StatusBadge } from '../../design-system/components';
import { demo } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Juridik och DPO: granskningar, känsliga åtkomster, utlämnanden. */
export default function JuridikPage() {
  const sensitiveFlags = demo.allFlags.filter((f) =>
    [
      'lss_sensitive_document_access_without_reason',
      'ea_sensitive_field_reveal_without_reason',
      'lss_protected_identity_without_elevated_protection',
      'ea_protected_household_without_elevated_access',
    ].includes(f.ruleKey),
  );
  return (
    <>
      <h1>Juridik och DPO</h1>
      <Card title="Väntar på granskning (demo)">
        <ul>
          <li>
            Exportförslag UBM-2026-0002{' '}
            <StatusBadge status="Kräver juridisk granskning" tone="warning" />
          </li>
          <li>
            Exportförslag UBM-2026-0003{' '}
            <StatusBadge status="Kräver DPO-granskning" tone="warning" />
          </li>
          <li>
            Utlämnandeärende AH-2026-011{' '}
            <StatusBadge status="Sekretessprövning pågår" tone="info" />
          </li>
        </ul>
      </Card>
      <Card title="Känsliga åtkomster att granska">
        {sensitiveFlags.length === 0 ? (
          <p>Inga avvikande känsliga åtkomster i perioden.</p>
        ) : (
          <ul>
            {sensitiveFlags.slice(0, 8).map((flag, i) => (
              <li key={i}>
                <StatusBadge status={flag.severity} tone="danger" /> {flag.explanation}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="DPO-verktyg">
        <ul>
          <li>Åtkomstgranskningsrapport (nyfikenhetsdetektering)</li>
          <li>Break-glass-sessioner med efterhandsgranskning</li>
          <li>Supportsessioner (alltid utan personuppgifter)</li>
          <li>Registerutdrag och dataskyddsärenden</li>
          <li>DPIA-dokumentation och rättslig grund per datatyp</li>
          <li>Gallringsstatus och utlämnandehistorik</li>
        </ul>
      </Card>
    </>
  );
}
