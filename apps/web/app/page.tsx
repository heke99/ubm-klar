import { Card, StatGrid, StatusBadge } from '../design-system/components';
import { apiGet } from '../lib/api';
import { requireSession, hasAnyRole } from '../lib/require-session';
import { ApiStateGuard, DemoDataWarning, NoDataYet } from '../components/page-states';

export const dynamic = 'force-dynamic';

interface DashboardResponse {
  dataSource: 'data_plane' | 'demo' | 'empty';
  stats?: {
    activeDecisions?: number;
    paidAmountSekTotal?: number;
    openRiskFlags?: number;
    openRecoveryClaims?: number;
    householdsTotal?: number;
    personsTotal?: number;
    amountAtRiskSekTotal?: number;
  };
  demoDashboard?: {
    amountAtRiskSekTotal: number;
    openRecoveryClaims: number;
    paidAmountSekTotal: number;
    flagsBySeverity: Record<string, number>;
  };
}

interface RequestsResponse {
  dataSource: string;
  requests: Array<{ id: string; status: string }>;
  counts: Record<string, number>;
}

const formatSek = (value: number) =>
  new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(value);

/** Översikt: ledningsvy med verkliga uppgifter från kommunens dataplan. */
export default async function OversiktPage() {
  const session = await requireSession();
  const canSeeLss = hasAnyRole(session, [
    'lss_case_worker',
    'social_services_manager',
    'control_investigator',
    'read_only_reviewer',
    'municipality_admin',
    'system_owner',
  ]);
  const canSeeEa = hasAnyRole(session, [
    'economic_assistance_case_worker',
    'social_services_manager',
    'control_investigator',
    'read_only_reviewer',
    'municipality_admin',
    'system_owner',
  ]);
  const canSeeUbm = hasAnyRole(session, [
    'ubm_export_manager',
    'lawyer',
    'dpo',
    'social_services_manager',
  ]);

  const [lss, ea, requests] = await Promise.all([
    canSeeLss ? apiGet<DashboardResponse>('/dashboards/lss') : Promise.resolve(undefined),
    canSeeEa
      ? apiGet<DashboardResponse>('/dashboards/economic-assistance')
      : Promise.resolve(undefined),
    canSeeUbm ? apiGet<RequestsResponse>('/ubm/requests') : Promise.resolve(undefined),
  ]);

  const isDemo = lss?.kind === 'ok' && lss.data.dataSource === 'demo';
  const lssStats = lss?.kind === 'ok' ? lss.data : undefined;
  const eaStats = ea?.kind === 'ok' ? ea.data : undefined;
  const openRequests =
    requests?.kind === 'ok'
      ? Object.entries(requests.data.counts)
          .filter(([status]) => !['closed', 'rejected'].includes(status))
          .reduce((sum, [, count]) => sum + count, 0)
      : undefined;

  const amountAtRisk =
    (lssStats?.stats?.amountAtRiskSekTotal ?? lssStats?.demoDashboard?.amountAtRiskSekTotal ?? 0) +
    (eaStats?.stats?.amountAtRiskSekTotal ?? eaStats?.demoDashboard?.amountAtRiskSekTotal ?? 0);
  const hasAnyData =
    (lssStats && lssStats.dataSource !== 'empty') || (eaStats && eaStats.dataSource !== 'empty');

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Översikt</h1>
      {isDemo ? <DemoDataWarning /> : null}
      {lss && lss.kind !== 'ok' ? <ApiStateGuard result={lss} /> : null}
      {hasAnyData ? (
        <StatGrid
          stats={[
            ...(lssStats
              ? [
                  {
                    label: 'Aktiva LSS-beslut',
                    value:
                      lssStats.stats?.activeDecisions ??
                      (lssStats.dataSource === 'demo' ? 'demo' : 0),
                  },
                  {
                    label: 'Öppna riskflaggor (LSS)',
                    value:
                      lssStats.stats?.openRiskFlags ??
                      Object.values(lssStats.demoDashboard?.flagsBySeverity ?? {}).reduce(
                        (a, b) => a + b,
                        0,
                      ),
                    tone: 'warning' as const,
                  },
                ]
              : []),
            ...(eaStats
              ? [
                  { label: 'Hushåll (EB)', value: eaStats.stats?.householdsTotal ?? 0 },
                  {
                    label: 'Utbetalt (EB)',
                    value: formatSek(
                      eaStats.stats?.paidAmountSekTotal ??
                        eaStats.demoDashboard?.paidAmountSekTotal ??
                        0,
                    ),
                  },
                ]
              : []),
            ...(openRequests !== undefined
              ? [{ label: 'Öppna UBM-förfrågningar', value: openRequests }]
              : []),
            { label: 'Riskbelopp totalt', value: formatSek(amountAtRisk), tone: 'danger' as const },
          ]}
        />
      ) : (
        <NoDataYet what="inga verksamhetsuppgifter" />
      )}
      <Card title="Status">
        {hasAnyData ? (
          <StatusBadge status="Data från kommunens dataplan" tone="success" />
        ) : (
          <StatusBadge status="Väntar på import av kommunens data" tone="info" />
        )}
      </Card>
      <Card title="Nästa steg">
        <ul>
          <li>Registrera och handlägg UBM-förfrågningar under UBM-förfrågningar.</li>
          <li>Följ upp riskflaggor och kontrollärenden under Kontrollärenden.</li>
          <li>Importera verksamhetsdata under Importer.</li>
          <li>Följ beredskapsgrindarna under Inställningar.</li>
        </ul>
      </Card>
    </div>
  );
}
