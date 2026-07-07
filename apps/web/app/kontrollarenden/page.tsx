import { Card, StatGrid, StatusBadge } from '../../design-system/components';
import { demo, formatSek } from '../../components/demo-data';

export const dynamic = 'force-static';

/** Kontrollärenden: riskflaggor med hög allvarlighet blir ärenden. */
export default function KontrollarendenPage() {
  const seriousFlags = demo.allFlags
    .filter((f) => f.severity === 'high' || f.severity === 'critical')
    .slice(0, 12);
  return (
    <>
      <h1>Kontrollärenden</h1>
      <StatGrid
        stats={[
          { label: 'Öppna riskflaggor', value: demo.allFlags.length, tone: 'warning' },
          {
            label: 'Hög/kritisk allvarlighet',
            value: demo.allFlags.filter((f) => ['high', 'critical'].includes(f.severity)).length,
            tone: 'danger',
          },
          {
            label: 'Riskbelopp',
            value: formatSek(demo.allFlags.reduce((s, f) => s + (f.amountAtRiskSek ?? 0), 0)),
            tone: 'danger',
          },
        ]}
      />
      <Card title="Senaste allvarliga flaggor (demo)">
        <table>
          <caption>Riskflaggor som skapar kontrollärenden</caption>
          <thead>
            <tr>
              <th scope="col">Regel</th>
              <th scope="col">Allvarlighet</th>
              <th scope="col">Förklaring</th>
              <th scope="col">Rekommenderad åtgärd</th>
            </tr>
          </thead>
          <tbody>
            {seriousFlags.map((flag, i) => (
              <tr key={`${flag.ruleKey}-${flag.subjectId}-${i}`}>
                <td>
                  {flag.title}
                  <br />
                  <small>
                    {flag.ruleKey}@{flag.ruleVersion}
                  </small>
                </td>
                <td>
                  <StatusBadge
                    status={flag.severity}
                    tone={flag.severity === 'critical' ? 'danger' : 'warning'}
                  />
                </td>
                <td>{flag.explanation}</td>
                <td>{flag.recommendedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
