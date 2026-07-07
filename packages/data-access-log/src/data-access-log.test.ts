import { describe, expect, it } from 'vitest';
import {
  DataAccessLogger,
  InMemoryDataAccessSink,
  MissingAccessReasonError,
  PiiInTechnicalLogError,
  sanitizeTechnicalLogEvent,
} from './data-access-log';

describe('DataAccessLogger', () => {
  it('records access events with references only', async () => {
    const sink = new InMemoryDataAccessSink();
    const logger = new DataAccessLogger(sink);
    await logger.record({
      actorUserId: 'u1',
      accessKind: 'person_record_open',
      personId: 'p1',
      sessionKind: 'normal',
    });
    expect(sink.events).toHaveLength(1);
  });

  it('rejects reason-required access without a reason', async () => {
    const logger = new DataAccessLogger(new InMemoryDataAccessSink());
    await expect(
      logger.record({
        actorUserId: 'u1',
        accessKind: 'protected_identity_view',
        personId: 'p1',
        sessionKind: 'normal',
      }),
    ).rejects.toThrow(MissingAccessReasonError);
  });

  it('accepts reason-required access with a reason', async () => {
    const sink = new InMemoryDataAccessSink();
    const logger = new DataAccessLogger(sink);
    const event = await logger.record({
      actorUserId: 'u1',
      accessKind: 'break_glass_access',
      reason: 'Incident 2026-071: återställning av felaktig ärendestatus',
      sessionKind: 'break_glass',
    });
    expect(event.reason).toContain('Incident');
  });
});

describe('sanitizeTechnicalLogEvent', () => {
  it('passes clean technical events', () => {
    const event = sanitizeTechnicalLogEvent({
      level: 'error',
      code: 'E_IMPORT_TIMEOUT',
      message: 'import batch timed out after 300s',
      context: { batchId: 'b-1', rows: 12000 },
    });
    expect(event.code).toBe('E_IMPORT_TIMEOUT');
  });

  it('rejects events with personnummer in the message', () => {
    expect(() =>
      sanitizeTechnicalLogEvent({
        level: 'error',
        code: 'E_ROW',
        message: 'row failed for 19811218-9876',
      }),
    ).toThrow(PiiInTechnicalLogError);
  });

  it('rejects events with forbidden context field names', () => {
    expect(() =>
      sanitizeTechnicalLogEvent({
        level: 'info',
        code: 'X',
        message: 'ok',
        context: { bank_account: 'x' },
      }),
    ).toThrow(PiiInTechnicalLogError);
  });
});
