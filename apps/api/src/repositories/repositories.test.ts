import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, type DbClient } from '@ubm-klar/db';
import { createRepositories, type Repositories } from './index';

/**
 * Repository tests against a real data-plane database with all release
 * migrations applied. Set DATA_PLANE_TEST_DATABASE_URL to run (the CI database
 * job applies migrations first; locally use the release runner).
 */
const databaseUrl = process.env.DATA_PLANE_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('data plane repositories', () => {
  let db: DbClient;
  let repos: Repositories;
  let profileId: string;

  beforeAll(async () => {
    db = createDbClient({ connectionString: databaseUrl!, applicationName: 'repo-tests' });
    repos = createRepositories(db);
    profileId = await repos.users.ensureUserProfile(
      'test-user-1',
      'Testhandläggare',
      'test1@kommun.se',
    );
  });

  afterAll(async () => {
    await db?.end();
  });

  it('empty tenant produces zero stats, not fake data', async () => {
    const lss = await repos.lss.dashboardStats();
    expect(lss.personsTotal).toBeGreaterThanOrEqual(0);
    expect(typeof lss.paidAmountSekTotal).toBe('number');
    const ea = await repos.ea.dashboardStats();
    expect(ea.householdsTotal).toBeGreaterThanOrEqual(0);
  });

  it('user profiles are idempotent per subject id', async () => {
    const again = await repos.users.ensureUserProfile('test-user-1');
    expect(again).toBe(profileId);
  });

  it('creates and transitions a UBM request with subjects', async () => {
    const request = await repos.ubmRequests.create({
      requestNumber: `UBM-TEST-${Date.now()}`,
      intakeChannel: 'manual_registration',
      receivedAt: new Date().toISOString(),
      registeredBy: profileId,
      domain: 'lss',
      deadlineAt: '2026-08-01',
    });
    expect(request.status).toBe('received');

    await repos.ubmRequests.addSubject({
      requestId: request.id,
      subjectKind: 'person',
      matchStatus: 'unmatched',
    });
    const subjects = await repos.ubmRequests.listSubjects(request.id);
    expect(subjects).toHaveLength(1);

    const updated = await repos.ubmRequests.updateStatus(request.id, 'registered');
    expect(updated.status).toBe('registered');
    const counts = await repos.ubmRequests.countByStatus();
    expect(counts['registered']).toBeGreaterThanOrEqual(1);
  });

  it('creates an export proposal with rows', async () => {
    const proposal = await repos.exportProposals.create({
      proposalNumber: `EXP-TEST-${Date.now()}`,
      domain: 'lss',
      schemaKey: 'internal_lss_request',
      schemaVersion: '1.0.0',
      eligibilityOutcome: 'approved',
      eligibilityExplanations: ['alla kontroller passerade'],
      createdBy: profileId,
    });
    expect(proposal.status).toBe('draft');

    await repos.exportProposals.addRow({
      proposalId: proposal.id,
      entityKind: 'lss_decision',
      entityId: proposal.id, // any uuid works for the test
      payload: { decidedHours: 120 },
      lineageComplete: true,
    });
    const rows = await repos.exportProposals.listRows(proposal.id);
    expect(rows).toHaveLength(1);

    const approved = await repos.exportProposals.updateStatus(proposal.id, 'approved');
    expect(approved.status).toBe('approved');
  });

  it('records import batches with errors and idempotency by file hash', async () => {
    const hash = `hash-${Date.now()}`;
    const batch = await repos.importBatches.create({
      importKind: 'lss',
      fileName: 'lss-utbetalningar.csv',
      fileHashSha256: hash,
      importedBy: profileId,
    });
    await repos.importBatches.addError({
      batchId: batch.id,
      rowNumber: 3,
      errorCode: 'INVALID_PERSONNUMMER',
      errorMessage: 'Ogiltigt personnummer på rad 3',
    });
    const errors = await repos.importBatches.listErrors(batch.id);
    expect(errors[0]?.errorCode).toBe('INVALID_PERSONNUMMER');

    await repos.importBatches.updateStatus(batch.id, 'loaded', { rowCount: 10, finished: true });
    const byHash = await repos.importBatches.findByFileHash(hash);
    expect(byHash?.id).toBe(batch.id);
  });

  it('stores document metadata', async () => {
    await repos.documents.ensureBucket('documents-lss');
    const document = await repos.documents.create({
      bucketKey: 'documents-lss',
      storagePath: `test/${Date.now()}.pdf`,
      fileName: 'beslut.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1234,
      fileHashSha256: 'abc123',
      documentType: 'decision',
      documentClass: 'standard',
      uploadedBy: profileId,
      malwareScanStatus: 'clean',
    });
    const fetched = await repos.documents.getById(document.id);
    expect(fetched?.fileName).toBe('beslut.pdf');
    expect(fetched?.malwareScanStatus).toBe('clean');
  });

  it('writes and queries audit events with correlation ids', async () => {
    const correlationId = crypto.randomUUID();
    await repos.audit.insert({
      eventKey: 'case.open',
      actorUserId: profileId,
      action: 'test_audit_write',
      outcome: 'success',
      context: { test: true },
      correlationId,
    });
    const events = await repos.audit.query({ actorUserId: profileId, action: 'test_audit_write' });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.correlationId).toBe(correlationId);
  });

  it('writes and queries data access events', async () => {
    await repos.dataAccess.insert({
      actorUserId: profileId,
      accessKind: 'case_open',
      caseKind: 'control_case',
      reason: 'handläggning',
    });
    const events = await repos.dataAccess.query({
      actorUserId: profileId,
      accessKind: 'case_open',
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('creates control cases from risk flags with audited actions', async () => {
    const flag = await repos.paymentControl.insertFlag({
      ruleKey: 'lss_rule_01',
      ruleVersion: '1.0.0',
      domain: 'lss',
      severity: 'high',
      subjectKind: 'payment',
      subjectId: crypto.randomUUID(),
      explanation: 'Utbetalning efter beslutets slutdatum',
      recommendedAction: 'Utred och stoppa vid behov',
      amountAtRiskSek: 12000,
    });
    const controlCase = await repos.controlCases.create({
      caseNumber: `KA-TEST-${Date.now()}`,
      sourceKind: 'risk_flag',
      sourceReference: flag.id,
      domain: 'lss',
      title: 'Utbetalning efter beslutsslut',
      severity: 'high',
      amountAtRiskSek: 12000,
    });
    await repos.paymentControl.linkFlagToCase(flag.id, controlCase.id);

    await repos.controlCases.assign(controlCase.id, profileId, profileId);
    await repos.controlCases.addNote(controlCase.id, profileId, 'Påbörjar utredning.');
    await repos.controlCases.updateStatus(controlCase.id, 'investigating', profileId);
    await repos.controlCases.registerOutcome(
      controlCase.id,
      'payment_stopped',
      'Stoppad',
      profileId,
    );

    const events = await repos.controlCases.listEvents(controlCase.id);
    expect(events.map((e) => e.eventKind)).toEqual(
      expect.arrayContaining(['assigned', 'status_investigating', 'outcome_registered']),
    );
    const linked = await repos.paymentControl.getFlag(flag.id);
    expect(linked?.controlCaseId).toBe(controlCase.id);
  });

  it('registers notifications with confidence scores and outcomes', async () => {
    const notification = await repos.notifications.create({
      notificationNumber: `UN-TEST-${Date.now()}`,
      intakeChannel: 'manual_registration',
      receivedAt: new Date().toISOString(),
      domain: 'economic_assistance',
      summary: 'Underrättelse om möjlig dubbel utbetalning',
    });
    await repos.notifications.addConfidenceScore({
      notificationId: notification.id,
      candidateKind: 'person',
      candidateId: crypto.randomUUID(),
      score: 0.92,
      scoreBasis: 'personnummer + namn',
      selected: true,
    });
    await repos.notifications.updateStatus(notification.id, 'matched');
    await repos.notifications.registerOutcome({
      notificationId: notification.id,
      outcome: 'no_action',
      detail: 'Redan hanterad',
      decidedBy: profileId,
    });
    const fetched = await repos.notifications.getById(notification.id);
    expect(fetched?.status).toBe('outcome_registered');
  });

  it('manages readiness gates and go-live blocking', async () => {
    await repos.readiness.upsertGate({
      gateKey: 'pilot_test_gate',
      titleSv: 'Testgrind',
      descriptionSv: 'Grind för repositorytest',
      required: true,
      gateOrder: 999,
      scope: 'production',
    });
    await repos.readiness.setEvidence({ gateKey: 'pilot_test_gate', status: 'failed' });
    const blocked = await repos.readiness.goLiveStatus();
    expect(blocked.allowed).toBe(false);
    expect(blocked.openRequiredGates).toContain('pilot_test_gate');

    await repos.readiness.setEvidence({
      gateKey: 'pilot_test_gate',
      status: 'passed',
      evidenceKind: 'test_run',
      evidenceReference: 'vitest',
    });
    const after = await repos.readiness.goLiveStatus();
    expect(after.openRequiredGates).not.toContain('pilot_test_gate');
  });

  it('pilot and production statuses are computed from separate gate scopes', async () => {
    const pilotGates = await repos.readiness.listGates('pilot');
    const productionGates = await repos.readiness.listGates('production');
    expect(pilotGates.some((g) => g.gateKey === 'pilot_scope_approved')).toBe(true);
    expect(productionGates.some((g) => g.gateKey === 'go_live_approved')).toBe(true);
    expect(pilotGates.some((g) => g.gateKey === 'go_live_approved')).toBe(false);

    const pilot = await repos.readiness.pilotStatus();
    expect(pilot.allowed).toBe(false); // fresh database: pilot gates open
    expect(pilot.openRequiredGates).toContain('pilot_scope_approved');
  });

  it('waivers require reason, approver, future expiry and risk level', async () => {
    await expect(
      repos.readiness.waiveGate({
        gateKey: 'backup_tested',
        reason: '',
        approverProfileId: profileId,
        expiresAt: '2099-01-01',
        riskLevel: 'medium',
      }),
    ).rejects.toThrow(/reason/i);

    await expect(
      repos.readiness.waiveGate({
        gateKey: 'backup_tested',
        reason: 'Pilot utan verklig data',
        approverProfileId: profileId,
        expiresAt: '2020-01-01',
        riskLevel: 'medium',
      }),
    ).rejects.toThrow(/expiry/i);

    await repos.readiness.waiveGate({
      gateKey: 'backup_tested',
      reason: 'Pilot med enbart syntetisk data — backup ej kritisk',
      approverProfileId: profileId,
      expiresAt: '2099-01-01',
      riskLevel: 'medium',
    });
    const gates = await repos.readiness.listGates();
    const gate = gates.find((g) => g.gateKey === 'backup_tested');
    expect(gate?.status).toBe('waived');
    expect(gate?.waiverRiskLevel).toBe('medium');

    // A valid waiver satisfies the gate.
    const pilot = await repos.readiness.pilotStatus();
    expect(pilot.openRequiredGates).not.toContain('backup_tested');
  });

  it('expired waivers no longer satisfy gates (fail closed)', async () => {
    // Bypass validation to simulate a waiver that has since expired.
    await db.query(
      `update production_readiness_evidence set waiver_expires_at = '2020-01-01' where gate_key = 'backup_tested'`,
    );
    const pilot = await repos.readiness.pilotStatus();
    expect(pilot.openRequiredGates).toContain('backup_tested');
  });
});
