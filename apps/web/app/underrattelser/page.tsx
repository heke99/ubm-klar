import { Card, StatusBadge } from '../../design-system/components';

export const dynamic = 'force-static';

/** Underrättelser från UBM: matchning med konfidenspoäng → kontrollärende. */
export default function UnderrattelserPage() {
  const notifications = [
    {
      id: 'UN-2026-001',
      confidence: 0.95,
      status: 'Automatiskt matchad',
      tone: 'success' as const,
      next: 'Kontrollärende skapat',
    },
    {
      id: 'UN-2026-002',
      confidence: 0.72,
      status: 'Manuell granskning',
      tone: 'warning' as const,
      next: 'Bekräfta matchning',
    },
    {
      id: 'UN-2026-003',
      confidence: 0.31,
      status: 'Ingen matchning',
      tone: 'danger' as const,
      next: 'Utred underlag',
    },
  ];
  return (
    <>
      <h1>Underrättelser</h1>
      <Card title="Inkomna underrättelser (demo)">
        <table>
          <caption>Underrättelser från Utbetalningsmyndigheten</caption>
          <thead>
            <tr>
              <th scope="col">Underrättelse</th>
              <th scope="col">Konfidens</th>
              <th scope="col">Status</th>
              <th scope="col">Nästa steg</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n) => (
              <tr key={n.id}>
                <td>{n.id}</td>
                <td>{Math.round(n.confidence * 100)} %</td>
                <td>
                  <StatusBadge status={n.status} tone={n.tone} />
                </td>
                <td>{n.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Utfall som återrapporteras">
        <ul>
          <li>Återkrav initierat</li>
          <li>Utbetalning stoppad</li>
          <li>Ingen åtgärd</li>
          <li>Polisanmälan</li>
          <li>Källdata rättad</li>
          <li>Annan åtgärd</li>
        </ul>
      </Card>
    </>
  );
}
