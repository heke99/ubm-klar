import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildXlsx } from '@ubm-klar/import-engine';
import type { PermissionKey } from '@ubm-klar/access-control';
import type { Repositories } from './repositories';

/**
 * Pilot reports over REAL data. Every report is permission-gated; rows contain
 * aggregates and case references — never more personal data than the caller's
 * role already grants. Export formats: JSON, CSV, XLSX.
 */

interface ReportResult {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}

interface ReportDefinition {
  key: string;
  titleSv: string;
  permission: PermissionKey;
  run: (repos: Repositories) => Promise<ReportResult>;
}

const num = (value: unknown) => Number(value ?? 0);

const REPORTS: ReportDefinition[] = [
  {
    key: 'ubm-beredskap',
    titleSv: 'UBM-beredskapsrapport',
    permission: 'readiness.manage',
    run: async (repos) => {
      const gates = await repos.readiness.listGates();
      return {
        columns: [
          { key: 'gate', label: 'Grind' },
          { key: 'scope', label: 'Omfattning' },
          { key: 'required', label: 'Obligatorisk' },
          { key: 'status', label: 'Status' },
          { key: 'evidence', label: 'Evidens' },
        ],
        rows: gates.map((gate) => ({
          gate: gate.titleSv,
          scope: gate.scope,
          required: gate.required ? 'ja' : 'nej',
          status: gate.status,
          evidence: gate.evidenceReference ?? '',
        })),
      };
    },
  },
  {
    key: 'ubm-forfragningar',
    titleSv: 'Öppna UBM-förfrågningar och svarsfrister',
    permission: 'ubm.request.read',
    run: async (repos) => {
      const requests = await repos.ubmRequests.list({ limit: 500 });
      const open = requests.filter((r) => !['closed', 'rejected'].includes(r.status));
      const today = new Date().toISOString().slice(0, 10);
      return {
        columns: [
          { key: 'requestNumber', label: 'Ärendenummer' },
          { key: 'status', label: 'Status' },
          { key: 'domain', label: 'Område' },
          { key: 'receivedAt', label: 'Mottagen' },
          { key: 'deadlineAt', label: 'Frist' },
          { key: 'overdue', label: 'Försenad' },
        ],
        rows: open.map((request) => ({
          requestNumber: request.requestNumber,
          status: request.status,
          domain: request.domain ?? 'okänt',
          receivedAt: request.receivedAt.slice(0, 10),
          deadlineAt: request.deadlineAt ?? '',
          overdue: request.deadlineAt && request.deadlineAt < today ? 'JA' : 'nej',
        })),
      };
    },
  },
  {
    key: 'exportforslag',
    titleSv: 'Exportförslag per status',
    permission: 'ubm.request.read',
    run: async (repos) => {
      const counts = await repos.exportProposals.countByStatus();
      return {
        columns: [
          { key: 'status', label: 'Status' },
          { key: 'count', label: 'Antal' },
        ],
        rows: Object.entries(counts).map(([status, count]) => ({ status, count })),
      };
    },
  },
  {
    key: 'blockerade-exporter',
    titleSv: 'Blockerade exporter med skäl',
    permission: 'ubm.request.read',
    run: async (repos) => {
      const blocked = await repos.exportProposals.list({
        status: 'eligibility_blocked',
        limit: 200,
      });
      return {
        columns: [
          { key: 'proposalNumber', label: 'Förslag' },
          { key: 'outcome', label: 'Utfall' },
          { key: 'reasons', label: 'Skäl' },
        ],
        rows: blocked.map((proposal) => ({
          proposalNumber: proposal.proposalNumber,
          outcome: proposal.eligibilityOutcome,
          reasons: proposal.eligibilityExplanations.join(' | '),
        })),
      };
    },
  },
  {
    key: 'lss-risk',
    titleSv: 'LSS — betalningsrisker',
    permission: 'payment.read',
    run: async (repos) => {
      const summary = await repos.paymentControl.flagSummary('lss');
      return {
        columns: [
          { key: 'ruleKey', label: 'Regel' },
          { key: 'count', label: 'Antal flaggor' },
          { key: 'amountAtRiskSek', label: 'Riskbelopp (SEK)' },
        ],
        rows: summary.byRule,
      };
    },
  },
  {
    key: 'eb-risk',
    titleSv: 'Ekonomiskt bistånd — betalningsrisker',
    permission: 'payment.read',
    run: async (repos) => {
      const summary = await repos.paymentControl.flagSummary('economic_assistance');
      return {
        columns: [
          { key: 'ruleKey', label: 'Regel' },
          { key: 'count', label: 'Antal flaggor' },
          { key: 'amountAtRiskSek', label: 'Riskbelopp (SEK)' },
        ],
        rows: summary.byRule,
      };
    },
  },
  {
    key: 'kontrollarenden',
    titleSv: 'Kontrollärenden',
    permission: 'case.control.read',
    run: async (repos) => {
      const cases = await repos.controlCases.list({ limit: 500 });
      return {
        columns: [
          { key: 'caseNumber', label: 'Ärendenummer' },
          { key: 'domain', label: 'Område' },
          { key: 'severity', label: 'Allvarlighet' },
          { key: 'status', label: 'Status' },
          { key: 'outcome', label: 'Utfall' },
          { key: 'amountAtRiskSek', label: 'Riskbelopp (SEK)' },
        ],
        rows: cases.map((controlCase) => ({
          caseNumber: controlCase.caseNumber,
          domain: controlCase.domain,
          severity: controlCase.severity,
          status: controlCase.status,
          outcome: controlCase.outcome ?? '',
          amountAtRiskSek: controlCase.amountAtRiskSek ?? 0,
        })),
      };
    },
  },
  {
    key: 'datakvalitet',
    titleSv: 'Datakvalitet',
    permission: 'import.run',
    run: async (repos) => {
      const quality = await repos.db.query<Record<string, string>>(
        `select
           (select count(*) from persons where personal_identity_number is null) as personer_utan_idnummer,
           (select count(*) from lss_payments where decision_id is null) as lss_betalningar_utan_beslut,
           (select count(*) from ea_payments where decision_id is null) as eb_betalningar_utan_beslut,
           (select count(*) from lss_payments where person_id is null and provider_id is null) as lss_betalningar_utan_mottagare,
           (select count(*) from persons where is_synthetic = true) as syntetiska_personer`,
      );
      const row = quality.rows[0]!;
      return {
        columns: [
          { key: 'kontroll', label: 'Kontroll' },
          { key: 'antal', label: 'Antal' },
        ],
        rows: Object.entries(row).map(([key, value]) => ({
          kontroll: key.replaceAll('_', ' '),
          antal: num(value),
        })),
      };
    },
  },
  {
    key: 'importfel',
    titleSv: 'Importfel',
    permission: 'import.run',
    run: async (repos) => {
      const errors = await repos.db.query<{
        file_name: string | null;
        row_number: number | null;
        error_code: string;
        error_message: string;
      }>(
        `select b.file_name, e.row_number, e.error_code, e.error_message
         from import_errors e join import_batches b on b.id = e.batch_id
         order by b.started_at desc limit 500`,
      );
      return {
        columns: [
          { key: 'fil', label: 'Fil' },
          { key: 'rad', label: 'Rad' },
          { key: 'felkod', label: 'Felkod' },
          { key: 'meddelande', label: 'Meddelande' },
        ],
        rows: errors.rows.map((row) => ({
          fil: row.file_name ?? '',
          rad: row.row_number ?? '',
          felkod: row.error_code,
          meddelande: row.error_message,
        })),
      };
    },
  },
  {
    key: 'revisionsatkomst',
    titleSv: 'Revisionsrapport (händelser per typ)',
    permission: 'audit.read',
    run: async (repos) => {
      const events = await repos.db.query<{ event_key: string; outcome: string; count: string }>(
        `select event_key, outcome, count(*) as count from audit_events
         group by event_key, outcome order by count(*) desc limit 200`,
      );
      return {
        columns: [
          { key: 'eventKey', label: 'Händelsetyp' },
          { key: 'outcome', label: 'Utfall' },
          { key: 'count', label: 'Antal' },
        ],
        rows: events.rows.map((row) => ({
          eventKey: row.event_key,
          outcome: row.outcome,
          count: num(row.count),
        })),
      };
    },
  },
  {
    key: 'dataatkomst',
    titleSv: 'Dataåtkomstrapport (åtkomster per typ)',
    permission: 'access_log.read',
    run: async (repos) => {
      const events = await repos.db.query<{
        access_kind: string;
        session_kind: string;
        count: string;
      }>(
        `select access_kind, session_kind, count(*) as count from data_access_events
         group by access_kind, session_kind order by count(*) desc limit 200`,
      );
      return {
        columns: [
          { key: 'accessKind', label: 'Åtkomsttyp' },
          { key: 'sessionKind', label: 'Sessionstyp' },
          { key: 'count', label: 'Antal' },
        ],
        rows: events.rows.map((row) => ({
          accessKind: row.access_kind,
          sessionKind: row.session_kind,
          count: num(row.count),
        })),
      };
    },
  },
  {
    key: 'go-live',
    titleSv: 'Go-live-beredskap',
    permission: 'readiness.manage',
    run: async (repos) => {
      const [production, pilot] = await Promise.all([
        repos.readiness.goLiveStatus(),
        repos.readiness.pilotStatus(),
      ]);
      return {
        columns: [
          { key: 'niva', label: 'Nivå' },
          { key: 'tillaten', label: 'Tillåten' },
          { key: 'oppnaGrindar', label: 'Öppna obligatoriska grindar' },
          { key: 'dispenser', label: 'Aktiva dispenser' },
        ],
        rows: [
          {
            niva: 'Pilot',
            tillaten: pilot.allowed ? 'JA' : 'NEJ',
            oppnaGrindar: pilot.openRequiredGates.join(', ') || 'inga',
            dispenser: pilot.waivedGates.join(', ') || 'inga',
          },
          {
            niva: 'Produktion',
            tillaten: production.allowed ? 'JA' : 'NEJ',
            oppnaGrindar: production.openRequiredGates.join(', ') || 'inga',
            dispenser: production.waivedGates.join(', ') || 'inga',
          },
        ],
      };
    },
  },
  {
    key: 'pilotutfall',
    titleSv: 'Pilotutfall',
    permission: 'readiness.manage',
    run: async (repos) => {
      const stats = await repos.db.query<Record<string, string>>(
        `select
           (select count(*) from ubm_requests) as ubm_forfragningar,
           (select count(*) from ubm_requests where status = 'closed') as avslutade_forfragningar,
           (select count(*) from ubm_export_proposals) as exportforslag,
           (select count(*) from ubm_submissions where status in ('sent','receipt_received')) as skickade_paket,
           (select count(*) from import_batches where status in ('loaded','partially_loaded')) as inlasta_importer,
           (select count(*) from control_cases) as kontrollarenden,
           (select count(*) from risk_flags where dry_run = false) as riskflaggor,
           (select count(*) from ubm_notifications) as underrattelser,
           (select count(*) from audit_events) as revisionshandelser,
           (select count(*) from data_access_events) as dataatkomster`,
      );
      const row = stats.rows[0]!;
      return {
        columns: [
          { key: 'matvarde', label: 'Mätvärde' },
          { key: 'antal', label: 'Antal' },
        ],
        rows: Object.entries(row).map(([key, value]) => ({
          matvarde: key.replaceAll('_', ' '),
          antal: num(value),
        })),
      };
    },
  },
  {
    key: 'ubm-sla',
    titleSv: 'UBM svarsfrister (SLA)',
    permission: 'ubm.request.read',
    run: async (repos) => {
      const rows = await repos.db.query<{
        request_number: string;
        status: string;
        received_at: Date;
        deadline_at: Date | null;
        days_left: string | null;
      }>(
        `select request_number, status, received_at, deadline_at,
                case when deadline_at is not null then (deadline_at - current_date)::text end as days_left
         from ubm_requests where status not in ('closed','rejected')
         order by deadline_at nulls last limit 200`,
      );
      return {
        columns: [
          { key: 'requestNumber', label: 'Ärendenummer' },
          { key: 'status', label: 'Status' },
          { key: 'deadline', label: 'Frist' },
          { key: 'daysLeft', label: 'Dagar kvar' },
        ],
        rows: rows.rows.map((row) => ({
          requestNumber: row.request_number,
          status: row.status,
          deadline: row.deadline_at ? row.deadline_at.toISOString().slice(0, 10) : '',
          daysLeft: row.days_left ?? '',
        })),
      };
    },
  },
];

function toCsv(result: ReportResult): string {
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = result.columns.map((column) => escape(column.label)).join(';');
  const lines = result.rows.map((row) =>
    result.columns.map((column) => escape(row[column.key])).join(';'),
  );
  return [header, ...lines].join('\n') + '\n';
}

export interface ReportRoutesOptions {
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: PermissionKey,
  ) => boolean;
}

export function registerReportRoutes(app: FastifyInstance, options: ReportRoutesOptions): void {
  const { requirePermission } = options;

  app.get('/reports', async (request) => {
    // Everyone sees the catalog; running a report enforces its permission.
    void request;
    return {
      reports: REPORTS.map((report) => ({
        key: report.key,
        titleSv: report.titleSv,
        permission: report.permission,
      })),
    };
  });

  app.get<{ Params: { key: string }; Querystring: { format?: 'json' | 'csv' | 'xlsx' } }>(
    '/reports/:key',
    async (request, reply) => {
      const report = REPORTS.find((candidate) => candidate.key === request.params.key);
      if (!report) return reply.status(404).send({ error: 'report_not_found' });
      if (!requirePermission(request, reply, report.permission)) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });

      const result = await report.run(request.repositories);
      const format = request.query.format ?? 'json';
      await request.auditLogger.record({
        eventKey: 'export.downloaded',
        actorUserId: request.subject!.userId,
        action: 'report_generated',
        context: {
          reportKey: report.key,
          format,
          rowCount: result.rows.length,
          correlationId: request.correlationId,
        },
      });

      if (format === 'csv') {
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${report.key}.csv"`)
          .send(toCsv(result));
      }
      if (format === 'xlsx') {
        const xlsx = buildXlsx([
          result.columns.map((column) => column.label),
          ...result.rows.map((row) =>
            result.columns.map((column) => String(row[column.key] ?? '')),
          ),
        ]);
        return reply
          .header(
            'content-type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          )
          .header('content-disposition', `attachment; filename="${report.key}.xlsx"`)
          .send(xlsx);
      }
      return { key: report.key, titleSv: report.titleSv, ...result };
    },
  );
}
