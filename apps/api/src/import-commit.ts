import type { DbClient } from '@ubm-klar/db';
import { isSyntheticPersonnummer } from '@ubm-klar/import-engine';

/**
 * Import committers: write validated, mapped rows into the tenant data plane.
 * One transaction per batch — either every valid row lands or none do.
 * Every committed row is linked back to its staging row (lineage).
 */

export interface CommitContext {
  tx: DbClient;
  batchId: string;
  importedByProfileId: string;
}

export interface CommittedRow {
  rowNumber: number;
  entityKind: string;
  entityId: string;
}

export class CommitError extends Error {
  constructor(
    public readonly rowNumber: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommitError';
  }
}

type Values = Record<string, string>;

async function ensurePerson(tx: DbClient, personnummer: string, values: Values): Promise<string> {
  const synthetic = isSyntheticPersonnummer(personnummer);
  const result = await tx.query<{ id: string }>(
    `insert into persons (personal_identity_number, is_synthetic, given_name, family_name, protected_identity)
     values ($1, $2, $3, $4, coalesce($5 in ('true','1','ja'), false))
     on conflict (personal_identity_number) do update set updated_at = now()
     returning id`,
    [
      personnummer,
      synthetic,
      values['given_name'] ?? null,
      values['family_name'] ?? null,
      values['protected_identity'] ?? null,
    ],
  );
  return result.rows[0]!.id;
}

async function findPerson(tx: DbClient, personnummer: string, rowNumber: number): Promise<string> {
  const result = await tx.query<{ id: string }>(
    'select id from persons where personal_identity_number = $1',
    [personnummer],
  );
  if (!result.rows[0]) {
    throw new CommitError(
      rowNumber,
      'PERSON_NOT_FOUND',
      `Personen finns inte — importera personer först (rad ${rowNumber})`,
    );
  }
  return result.rows[0].id;
}

async function ensureOrganization(
  tx: DbClient,
  orgNumber: string,
  name: string | undefined,
  orgKind: string,
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `insert into organizations (organization_number, name, org_kind)
     values ($1, coalesce($2, $1), $3)
     on conflict (organization_number) do update set is_active = true
     returning id`,
    [orgNumber, name ?? null, orgKind],
  );
  return result.rows[0]!.id;
}

async function ensureProvider(tx: DbClient, orgNumber: string, name?: string): Promise<string> {
  const orgId = await ensureOrganization(tx, orgNumber, name, 'assistance_provider');
  const result = await tx.query<{ id: string }>(
    `insert into assistance_providers (organization_id)
     values ($1::uuid)
     on conflict (organization_id) do update set provider_status = assistance_providers.provider_status
     returning id`,
    [orgId],
  );
  return result.rows[0]!.id;
}

async function findDecision(
  tx: DbClient,
  table: 'lss_decisions' | 'ea_decisions',
  decisionNumber: string,
): Promise<string | undefined> {
  const result = await tx.query<{ id: string }>(
    `select id from ${table} where decision_number = $1`,
    [decisionNumber],
  );
  return result.rows[0]?.id;
}

async function findHousehold(
  tx: DbClient,
  householdNumber: string,
  rowNumber: number,
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    'select id from ea_households where household_number = $1',
    [householdNumber],
  );
  if (!result.rows[0]) {
    throw new CommitError(
      rowNumber,
      'HOUSEHOLD_NOT_FOUND',
      `Hushållet ${householdNumber} finns inte — importera hushåll först (rad ${rowNumber})`,
    );
  }
  return result.rows[0].id;
}

type Committer = (ctx: CommitContext, rowNumber: number, values: Values) => Promise<CommittedRow>;

export const COMMITTERS: Record<string, Committer> = {
  lss_persons: async ({ tx }, rowNumber, values) => {
    const personId = await ensurePerson(tx, values['personnummer']!, values);
    await tx.query(
      `insert into lss_person_profiles (person_id) values ($1::uuid)
       on conflict (person_id) do nothing`,
      [personId],
    );
    return { rowNumber, entityKind: 'person', entityId: personId };
  },

  lss_decisions: async ({ tx }, rowNumber, values) => {
    const personId = await findPerson(tx, values['personnummer']!, rowNumber);
    const result = await tx.query<{ id: string }>(
      `insert into lss_decisions (person_id, decision_number, insats_kind, decision_kind, decided_at)
       values ($1::uuid, $2, $3, $4, $5)
       on conflict (decision_number) do update set status = lss_decisions.status
       returning id`,
      [
        personId,
        values['decision_number'],
        values['insats_kind'],
        values['decision_kind'],
        values['decided_at'],
      ],
    );
    const decisionId = result.rows[0]!.id;
    if (values['period_start']) {
      await tx.query(
        `insert into lss_decision_periods (decision_id, period_start, period_end)
         values ($1::uuid, $2, $3) on conflict do nothing`,
        [decisionId, values['period_start'], values['period_end'] ?? null],
      );
    }
    return { rowNumber, entityKind: 'lss_decision', entityId: decisionId };
  },

  lss_time_reports: async ({ tx }, rowNumber, values) => {
    const personId = await findPerson(tx, values['personnummer']!, rowNumber);
    const providerId = await ensureProvider(tx, values['provider_org_number']!);
    const result = await tx.query<{ id: string }>(
      `insert into assistance_time_reports (provider_id, person_id, period_start, period_end, total_hours)
       values ($1::uuid, $2::uuid, $3, $4, $5) returning id`,
      [
        providerId,
        personId,
        values['period_start'],
        values['period_end'],
        Number(values['total_hours']),
      ],
    );
    return { rowNumber, entityKind: 'assistance_time_report', entityId: result.rows[0]!.id };
  },

  lss_invoices: async ({ tx }, rowNumber, values) => {
    const providerId = await ensureProvider(tx, values['provider_org_number']!);
    const personId = values['personnummer']
      ? await findPerson(tx, values['personnummer'], rowNumber)
      : null;
    const result = await tx.query<{ id: string }>(
      `insert into provider_invoices
         (provider_id, invoice_number, invoice_org_number, person_id, period_start, period_end, total_hours, total_amount_sek)
       values ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8)
       on conflict (provider_id, invoice_number) do update set status = provider_invoices.status
       returning id`,
      [
        providerId,
        values['invoice_number'],
        values['provider_org_number'],
        personId,
        values['period_start'],
        values['period_end'],
        values['total_hours'] ? Number(values['total_hours']) : null,
        Number(values['total_amount_sek']),
      ],
    );
    return { rowNumber, entityKind: 'provider_invoice', entityId: result.rows[0]!.id };
  },

  lss_payments: async ({ tx }, rowNumber, values) => {
    const personId = values['personnummer']
      ? await findPerson(tx, values['personnummer'], rowNumber)
      : null;
    const decisionId = values['decision_number']
      ? await findDecision(tx, 'lss_decisions', values['decision_number'])
      : undefined;
    const providerId = values['provider_org_number']
      ? await ensureProvider(tx, values['provider_org_number'])
      : null;
    const result = await tx.query<{ id: string }>(
      `insert into lss_payments (person_id, provider_id, decision_id, amount_sek, payment_date, status)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5, coalesce($6, 'paid')) returning id`,
      [
        personId,
        providerId,
        decisionId ?? null,
        Number(values['amount_sek']),
        values['payment_date'],
        values['status'] ?? null,
      ],
    );
    return { rowNumber, entityKind: 'lss_payment', entityId: result.rows[0]!.id };
  },

  lss_providers: async ({ tx }, rowNumber, values) => {
    const providerId = await ensureProvider(tx, values['organization_number']!, values['name']);
    if (values['provider_status']) {
      await tx.query('update assistance_providers set provider_status = $2 where id = $1::uuid', [
        providerId,
        values['provider_status'],
      ]);
    }
    return { rowNumber, entityKind: 'assistance_provider', entityId: providerId };
  },

  ea_households: async ({ tx }, rowNumber, values) => {
    const householdResult = await tx.query<{ id: string }>(
      `insert into ea_households (household_number, household_kind)
       values ($1, $2)
       on conflict (household_number) do update set household_kind = excluded.household_kind
       returning id`,
      [values['household_number'], values['household_kind']],
    );
    const householdId = householdResult.rows[0]!.id;
    const personId = await ensurePerson(tx, values['personnummer']!, values);
    await tx.query(
      `insert into ea_person_profiles (person_id) values ($1::uuid) on conflict (person_id) do nothing`,
      [personId],
    );
    await tx.query(
      `insert into ea_household_members (household_id, person_id, member_role, valid_from)
       values ($1::uuid, $2::uuid, $3, $4)
       on conflict (household_id, person_id, valid_from) do update set member_role = excluded.member_role`,
      [householdId, personId, values['member_role'], values['valid_from']],
    );
    return { rowNumber, entityKind: 'ea_household', entityId: householdId };
  },

  ea_applications: async ({ tx }, rowNumber, values) => {
    const householdId = await findHousehold(tx, values['household_number']!, rowNumber);
    const result = await tx.query<{ id: string }>(
      `insert into ea_applications (household_id, application_number, received_at, application_kind)
       values ($1::uuid, $2, $3, coalesce($4, 'monthly'))
       on conflict (application_number) do update set status = ea_applications.status
       returning id`,
      [
        householdId,
        values['application_number'],
        values['received_at'],
        values['application_kind'] ?? null,
      ],
    );
    return { rowNumber, entityKind: 'ea_application', entityId: result.rows[0]!.id };
  },

  ea_decisions: async ({ tx }, rowNumber, values) => {
    const householdId = await findHousehold(tx, values['household_number']!, rowNumber);
    const application = await tx.query<{ id: string }>(
      'select id from ea_applications where application_number = $1',
      [values['application_number']],
    );
    if (!application.rows[0]) {
      throw new CommitError(
        rowNumber,
        'APPLICATION_NOT_FOUND',
        `Ansökan ${values['application_number']} finns inte — importera ansökningar först (rad ${rowNumber})`,
      );
    }
    const result = await tx.query<{ id: string }>(
      `insert into ea_decisions (application_id, household_id, decision_number, decision_kind, decided_at)
       values ($1::uuid, $2::uuid, $3, $4, $5)
       on conflict (decision_number) do update set status = ea_decisions.status
       returning id`,
      [
        application.rows[0].id,
        householdId,
        values['decision_number'],
        values['decision_kind'],
        values['decided_at'],
      ],
    );
    return { rowNumber, entityKind: 'ea_decision', entityId: result.rows[0]!.id };
  },

  ea_income_records: async ({ tx }, rowNumber, values) => {
    const application = await tx.query<{ id: string }>(
      'select id from ea_applications where application_number = $1',
      [values['application_number']],
    );
    if (!application.rows[0]) {
      throw new CommitError(
        rowNumber,
        'APPLICATION_NOT_FOUND',
        `Ansökan ${values['application_number']} finns inte (rad ${rowNumber})`,
      );
    }
    const personId = await findPerson(tx, values['personnummer']!, rowNumber);
    const result = await tx.query<{ id: string }>(
      `insert into ea_verified_income
         (application_id, person_id, amount_sek, period_start, period_end, verification_source)
       values ($1::uuid, $2::uuid, $3, $4, $5, $6) returning id`,
      [
        application.rows[0].id,
        personId,
        Number(values['amount_sek']),
        values['period_start'] ?? null,
        values['period_end'] ?? null,
        values['verification_source'],
      ],
    );
    return { rowNumber, entityKind: 'ea_verified_income', entityId: result.rows[0]!.id };
  },

  ea_housing_records: async ({ tx }, rowNumber, values) => {
    const householdId = await findHousehold(tx, values['household_number']!, rowNumber);
    const result = await tx.query<{ id: string }>(
      `insert into ea_housing_records (household_id, housing_kind, monthly_cost_sek, valid_from)
       values ($1::uuid, $2, $3, $4) returning id`,
      [
        householdId,
        values['housing_kind'],
        values['monthly_cost_sek'] ? Number(values['monthly_cost_sek']) : null,
        values['valid_from'],
      ],
    );
    return { rowNumber, entityKind: 'ea_housing_record', entityId: result.rows[0]!.id };
  },

  ea_payments: async ({ tx }, rowNumber, values) => {
    const householdId = values['household_number']
      ? await findHousehold(tx, values['household_number'], rowNumber)
      : null;
    const personId = values['personnummer']
      ? await findPerson(tx, values['personnummer'], rowNumber)
      : null;
    const decisionId = values['decision_number']
      ? await findDecision(tx, 'ea_decisions', values['decision_number'])
      : undefined;
    const result = await tx.query<{ id: string }>(
      `insert into ea_payments (household_id, person_id, decision_id, amount_sek, payment_date, status)
       values ($1::uuid, $2::uuid, $3::uuid, $4, $5, coalesce($6, 'paid')) returning id`,
      [
        householdId,
        personId,
        decisionId ?? null,
        Number(values['amount_sek']),
        values['payment_date'],
        values['status'] ?? null,
      ],
    );
    return { rowNumber, entityKind: 'ea_payment', entityId: result.rows[0]!.id };
  },

  payment_files: async ({ tx, batchId }, rowNumber, values) => {
    // One payment_files record per batch; rows attach to it.
    const fileResult = await tx.query<{ id: string }>(
      `insert into payment_files (import_batch_id, file_name, file_hash_sha256, file_format, row_count)
       select id, coalesce(file_name, 'betalfil'), coalesce(file_hash_sha256, ''), 'csv', coalesce(row_count, 0)
       from import_batches where id = $1::uuid
       on conflict do nothing
       returning id`,
      [batchId],
    );
    let paymentFileId = fileResult.rows[0]?.id;
    if (!paymentFileId) {
      const existing = await tx.query<{ id: string }>(
        'select id from payment_files where import_batch_id = $1::uuid',
        [batchId],
      );
      paymentFileId = existing.rows[0]!.id;
    }
    const personId = values['personnummer']
      ? (
          await tx.query<{ id: string }>(
            'select id from persons where personal_identity_number = $1',
            [values['personnummer']],
          )
        ).rows[0]?.id
      : undefined;
    const result = await tx.query<{ id: string }>(
      `insert into payment_file_rows
         (payment_file_id, row_number, external_payment_reference, recipient_account_reference,
          recipient_org_number, person_id, amount_sek, payment_date, domain_hint)
       values ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9)
       on conflict (payment_file_id, row_number) do update set amount_sek = excluded.amount_sek
       returning id`,
      [
        paymentFileId,
        rowNumber,
        values['external_payment_reference'] ?? null,
        values['recipient_account_reference'] ?? null,
        values['recipient_org_number'] ?? null,
        personId ?? null,
        Number(values['amount_sek']),
        values['payment_date'],
        values['domain_hint'] ?? null,
      ],
    );
    return { rowNumber, entityKind: 'payment_file_row', entityId: result.rows[0]!.id };
  },

  recipient_register: async ({ tx }, rowNumber, values) => {
    const kind = values['recipient_kind'];
    let personId: string | null = null;
    let organizationId: string | null = null;
    if (kind === 'person') {
      if (!values['personnummer']) {
        throw new CommitError(
          rowNumber,
          'MISSING_PERSONNUMMER',
          `Personnummer krävs för personmottagare (rad ${rowNumber})`,
        );
      }
      personId = await findPerson(tx, values['personnummer'], rowNumber);
    } else {
      if (!values['organization_number']) {
        throw new CommitError(
          rowNumber,
          'MISSING_ORG_NUMBER',
          `Organisationsnummer krävs (rad ${rowNumber})`,
        );
      }
      organizationId = await ensureOrganization(
        tx,
        values['organization_number'],
        undefined,
        'supplier',
      );
    }
    const result = await tx.query<{ id: string }>(
      `insert into payment_recipient_registry
         (recipient_kind, person_id, organization_id, account_kind, account_reference, valid_from)
       values ($1, $2::uuid, $3::uuid, $4, $5, coalesce($6::date, current_date)) returning id`,
      [
        kind,
        personId,
        organizationId,
        values['account_kind'],
        values['account_reference'],
        values['valid_from'] ?? null,
      ],
    );
    return { rowNumber, entityKind: 'payment_recipient', entityId: result.rows[0]!.id };
  },

  recovery_claims: async ({ tx }, rowNumber, values) => {
    const table = values['domain'] === 'lss' ? 'lss_recovery_claims' : 'ea_recovery_claims';
    const personId = values['personnummer']
      ? await findPerson(tx, values['personnummer'], rowNumber)
      : null;
    const result = await tx.query<{ id: string }>(
      `insert into ${table} (person_id, claim_number, amount_sek, reason)
       values ($1::uuid, $2, $3, $4)
       on conflict (claim_number) do update set status = ${table}.status
       returning id`,
      [personId, values['claim_number'], Number(values['amount_sek']), values['reason']],
    );
    return {
      rowNumber,
      entityKind: `${values['domain']}_recovery_claim`,
      entityId: result.rows[0]!.id,
    };
  },
};
