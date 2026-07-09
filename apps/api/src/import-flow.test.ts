import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDbClient } from '@ubm-klar/db';
import { buildXlsx } from '@ubm-klar/import-engine';
import type { TenantDirectory, TenantDirectoryRecord } from '@ubm-klar/tenant-resolver';
import { buildApiServer } from './server';
import { TenantDataPlanePool } from './data-plane';

/**
 * Full import pipeline test against a real data plane:
 * upload -> mapping -> preview -> validate -> commit, plus idempotency,
 * rollback-before-commit and synthetic-personnummer blocking for prod tenants.
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

/** Valid (Luhn-correct) personnummer for tests, 1912-style Skatteverket test range. */
const RUN_SALT = Date.now() % 800; // unique rows per test run (the test DB persists)
function testPersonnummer(rawSeed: number): string {
  const seed = rawSeed + RUN_SALT;
  const day = String(10 + (seed % 18)).padStart(2, '0');
  const serial = String(100 + (seed % 899));
  const nineDigits = `1201${day}${serial}`; // yymmdd + nnn
  for (let check = 0; check <= 9; check++) {
    const candidate = nineDigits + String(check);
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      let d = Number(candidate[i]);
      if (i % 2 === 0) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return `19${candidate}`;
  }
  throw new Error('no check digit found');
}

const record: TenantDirectoryRecord = {
  tenantId: 'tenant-malmo',
  tenantSlug: 'malmo',
  municipalityName: 'Malmö stad',
  deploymentMode: 'model_b_vendor_hosted_isolated',
  environment: 'prod',
  domain: 'malmo.ubmklar.se',
  domainVerified: true,
  activeModules: [
    'lss',
    'economic_assistance',
    'payment_control',
    'control_cases',
    'import_gateway',
  ],
  dataPlaneUrl: 'https://malmo-prod.example.supabase.co',
  dataPlanePublishableKey: 'sb_publishable_malmo',
  authProvider: 'entra_id',
  featureFlags: {},
};

const directory: TenantDirectory = {
  lookupByDomain: async (domain) => (domain === 'malmo.ubmklar.se' ? record : undefined),
};

const adminHeaders = {
  host: 'malmo.ubmklar.se',
  'x-user-id': 'import-admin',
  'x-roles': 'controller', // controller holds import.run
};

describe.skipIf(!databaseUrl)('import pipeline', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // sanity: database reachable
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'import-test' });
    await db.query('select 1');
    await db.end();

    app = buildApiServer({
      directory,
      allowDemoTenant: false,
      auth: { allowInsecureHeaderAuth: true }, // test-only
      dataPlane: new TenantDataPlanePool({ DATA_PLANE_DATABASE_URL: databaseUrl! }),
      demoDataEnabled: false,
    });
  });

  async function upload(
    fileName: string,
    content: Buffer | string,
    importTypeKey: string,
    sourceSystemKey = 'generic_csv',
  ) {
    return app.inject({
      method: 'POST',
      url: '/imports',
      headers: adminHeaders,
      payload: {
        fileName,
        contentBase64: Buffer.from(content).toString('base64'),
        importTypeKey,
        sourceSystemKey,
      },
    });
  }

  it('lists source systems with unavailable adapters clearly marked', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/imports/source-systems',
      headers: adminHeaders,
    });
    expect(response.statusCode).toBe(200);
    const systems = response.json().sourceSystems as Array<{
      key: string;
      available: boolean;
      unavailableReason?: string;
    }>;
    expect(systems.find((s) => s.key === 'generic_csv')?.available).toBe(true);
    const treserva = systems.find((s) => s.key === 'treserva');
    expect(treserva?.available).toBe(false);
    expect(treserva?.unavailableReason).toBeTruthy();
  });

  it('refuses unavailable source system adapters', async () => {
    const response = await upload(
      'test.csv',
      'personnummer;fornamn\n121212-1212;Test',
      'lss_persons',
      'treserva',
    );
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe('source_system_unavailable');
  });

  it('runs the full CSV flow: upload, map, preview, validate, commit', async () => {
    const pn1 = testPersonnummer(1);
    const pn2 = testPersonnummer(2);
    const csv = `pnr;fornamn;efternamn\n${pn1};Anna;Testsson\n${pn2};Bo;Testsson\n`;

    const uploadResponse = await upload(`persons-${Date.now()}.csv`, csv, 'lss_persons');
    expect(uploadResponse.statusCode).toBe(201);
    const { batchId, columns, mappingSuggestions, targetFields } = uploadResponse.json();
    expect(columns).toEqual(['pnr', 'fornamn', 'efternamn']);
    expect(Array.isArray(mappingSuggestions)).toBe(true);
    expect(targetFields.map((f: { field: string }) => f.field)).toContain('personnummer');

    const mappingResponse = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/mapping`,
      headers: adminHeaders,
      payload: {
        mappings: [
          {
            sourceColumn: 'pnr',
            targetField: 'personnummer',
            required: true,
            transform: 'personnummer_normalize',
          },
          { sourceColumn: 'fornamn', targetField: 'given_name', required: false },
          { sourceColumn: 'efternamn', targetField: 'family_name', required: false },
        ],
      },
    });
    expect(mappingResponse.statusCode).toBe(200);
    expect(mappingResponse.json().mappedRows).toBe(2);

    const preview = await app.inject({
      method: 'GET',
      url: `/imports/${batchId}/preview`,
      headers: adminHeaders,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().rows).toHaveLength(2);
    expect(preview.json().rows[0].mapped.personnummer).toBe(pn1);

    const validate = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/validate`,
      headers: adminHeaders,
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json().errorRows).toBe(0);
    expect(validate.json().validRows).toBe(2);

    const commit = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/commit`,
      headers: adminHeaders,
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().status).toBe('loaded');
    expect(commit.json().committedRows).toBe(2);

    // Committed rows exist in the data plane with lineage back to the batch.
    const db = createDbClient({ connectionString: databaseUrl!, applicationName: 'import-verify' });
    const person = await db.query(
      'select id, is_synthetic from persons where personal_identity_number = $1',
      [pn1],
    );
    expect(person.rows).toHaveLength(1);
    expect(person.rows[0]!.is_synthetic).toBe(false);
    const lineage = await db.query(
      `select committed_entity_kind, committed_entity_id from import_staging_rows
       where batch_id = $1::uuid and row_number = 1`,
      [batchId],
    );
    expect(lineage.rows[0]!.committed_entity_kind).toBe('person');
    expect(lineage.rows[0]!.committed_entity_id).toBeTruthy();
    await db.end();

    // Committed batches cannot be rolled back.
    const rollback = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/rollback`,
      headers: adminHeaders,
    });
    expect(rollback.statusCode).toBe(409);
  });

  it('is idempotent: the same file cannot be imported twice', async () => {
    const pn = testPersonnummer(3);
    const csv = `personnummer;referens\n${pn};idem-${Date.now()}\n`;
    const fileName = `idempotent-${Date.now()}.csv`;

    const first = await upload(fileName, csv, 'lss_persons');
    const batchId = first.json().batchId;
    await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/mapping`,
      headers: adminHeaders,
      payload: {
        mappings: [{ sourceColumn: 'personnummer', targetField: 'personnummer', required: true }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/validate`,
      headers: adminHeaders,
    });
    await app.inject({ method: 'POST', url: `/imports/${batchId}/commit`, headers: adminHeaders });

    const second = await upload(fileName, csv, 'lss_persons');
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('duplicate_file');
  });

  it('can be rolled back before commit', async () => {
    // unique content per run: file-hash idempotency applies across historical runs
    const csv = `personnummer;referens\n${testPersonnummer(4)};rb-${Date.now()}\n`;
    const uploadResponse = await upload(`rollback-${Date.now()}.csv`, csv, 'lss_persons');
    const batchId = uploadResponse.json().batchId;

    const rollback = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/rollback`,
      headers: adminHeaders,
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().status).toBe('rejected');

    const commit = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/commit`,
      headers: adminHeaders,
    });
    expect(commit.statusCode).toBe(409);
  });

  it('blocks synthetic personnummer for production tenants with clear errors', async () => {
    const csv = `personnummer\n129912-9873\n`; // month 99: synthetic
    const uploadResponse = await upload(`synthetic-${Date.now()}.csv`, csv, 'lss_persons');
    const batchId = uploadResponse.json().batchId;
    await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/mapping`,
      headers: adminHeaders,
      payload: {
        mappings: [{ sourceColumn: 'personnummer', targetField: 'personnummer', required: true }],
      },
    });
    const validate = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/validate`,
      headers: adminHeaders,
    });
    expect(validate.json().errorRows).toBe(1);
    expect(validate.json().issues[0].code).toBe('SYNTHETIC_PERSONNUMMER_FORBIDDEN');

    const commit = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/commit`,
      headers: adminHeaders,
    });
    expect(commit.statusCode).toBe(422);
    expect(commit.json().error).toBe('no_valid_rows');
  });

  it('imports XLSX payments with decision matching and understandable errors', async () => {
    const pn = testPersonnummer(5);
    // Prepare person + decision first.
    const personsCsv = `personnummer\n${pn}\n`;
    const personsUpload = await upload(
      `payments-persons-${Date.now()}.csv`,
      personsCsv,
      'lss_persons',
    );
    const personsBatch = personsUpload.json().batchId;
    await app.inject({
      method: 'POST',
      url: `/imports/${personsBatch}/mapping`,
      headers: adminHeaders,
      payload: {
        mappings: [{ sourceColumn: 'personnummer', targetField: 'personnummer', required: true }],
      },
    });
    await app.inject({
      method: 'POST',
      url: `/imports/${personsBatch}/validate`,
      headers: adminHeaders,
    });
    await app.inject({
      method: 'POST',
      url: `/imports/${personsBatch}/commit`,
      headers: adminHeaders,
    });

    const xlsx = buildXlsx([
      ['personnummer', 'belopp', 'datum', 'referens'],
      [pn, '12500', '2026-06-25', `ref-${Date.now()}-a`],
      [pn, '-100', '2026-06-26', `ref-${Date.now()}-b`], // negative: validation error
    ]);
    const uploadResponse = await upload(
      `payments-${Date.now()}.xlsx`,
      xlsx,
      'lss_payments',
      'generic_xlsx',
    );
    expect(uploadResponse.statusCode).toBe(201);
    const batchId = uploadResponse.json().batchId;

    await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/mapping`,
      headers: adminHeaders,
      payload: {
        mappings: [
          { sourceColumn: 'personnummer', targetField: 'personnummer', required: false },
          {
            sourceColumn: 'belopp',
            targetField: 'amount_sek',
            required: true,
            transform: 'amount_sek',
          },
          {
            sourceColumn: 'datum',
            targetField: 'payment_date',
            required: true,
            transform: 'date_iso',
          },
        ],
      },
    });
    const validate = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/validate`,
      headers: adminHeaders,
    });
    expect(validate.json().errorRows).toBe(1);
    const negativeIssue = validate
      .json()
      .issues.find((i: { code: string }) => i.code === 'NEGATIVE_AMOUNT');
    expect(negativeIssue.message).toContain('Negativt belopp');

    const commit = await app.inject({
      method: 'POST',
      url: `/imports/${batchId}/commit`,
      headers: adminHeaders,
    });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().status).toBe('partially_loaded');
    expect(commit.json().committedRows).toBe(1);
    expect(commit.json().skippedRows).toBe(1);
  });

  it('unauthorized roles cannot import', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/imports/types',
      headers: { ...adminHeaders, 'x-roles': 'read_only_reviewer' },
    });
    expect(response.statusCode).toBe(403);
  });
});
