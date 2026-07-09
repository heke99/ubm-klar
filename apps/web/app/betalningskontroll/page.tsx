import { Card, StatGrid, StatusBadge } from '../../design-system/components';
import { demo, formatSek } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Betalningskontroll: avstämning, dubbletter, mottagarkontroll. */
export default function BetalningskontrollPage() {
  const paymentFlags = demo.allFlags.filter((f) =>
    [
      'lss_duplicate_payment',
      'ea_duplicate_payment_household_period',
      'lss_payment_file_unknown_recipient',
      'ea_payment_file_row_without_decision',
      'lss_account_changed_near_payment',
      'ea_account_changed_near_payment',
      'lss_payment_despite_recovery_claim',
      'ea_payment_despite_recovery_claim',
    ].includes(f.ruleKey),
  );
  return (
    <>
      <h1>Betalningskontroll</h1>
      <StatGrid
        stats={[
          { label: 'Utbetalningar (LSS)', value: demo.lss.context.payments.length },
          { label: 'Utbetalningar (EB)', value: demo.ea.context.payments.length },
          { label: 'Betalningsflaggor', value: paymentFlags.length, tone: 'warning' },
          {
            label: 'Riskbelopp betalningar',
            value: formatSek(paymentFlags.reduce((s, f) => s + (f.amountAtRiskSek ?? 0), 0)),
            tone: 'danger',
          },
        ]}
      />
      <Card title="Avstämningskedja">
        <p>
          Beslut ↔ faktura/beräkning ↔ betalningsfil ↔ bokförd status ↔ mottagarregister ↔
          kontoändringslogg ↔ spärrlista ↔ återkrav. Varje avvikelse får en förklarbar flagga med
          beviskedja och rekommenderad åtgärd.
        </p>
        <p>
          Betalstatusar: created → pending_approval → approved → sent → paid, med paused / stopped /
          reversed / cancelled / recovery_started. Stopp och paus kräver fyra-ögon-godkännande.
        </p>
      </Card>
      <Card title="Senaste betalningsflaggor (demo)">
        {paymentFlags.slice(0, 8).map((flag, i) => (
          <p key={`${flag.ruleKey}-${i}`}>
            <StatusBadge
              status={flag.severity}
              tone={flag.severity === 'critical' ? 'danger' : 'warning'}
            />{' '}
            {flag.explanation}
          </p>
        ))}
      </Card>
    </>
  );
}
