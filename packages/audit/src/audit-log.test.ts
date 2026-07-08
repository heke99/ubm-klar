import { describe, expect, it } from 'vitest';
import { AuditLogger, InMemoryAuditSink, verifyChain } from './audit-log';

describe('AuditLogger', () => {
  it('chains events with hashes', async () => {
    const sink = new InMemoryAuditSink();
    const logger = new AuditLogger(sink);
    const first = await logger.record({
      eventKey: 'person.record_open',
      actorUserId: 'u1',
      action: 'open',
      subjectKind: 'person',
      subjectId: 'p1',
    });
    const second = await logger.record({
      eventKey: 'sensitive_field.reveal',
      actorUserId: 'u1',
      action: 'reveal',
      reason: 'Handläggning ärende 123',
    });
    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.eventHash);
    expect(verifyChain(sink.events).valid).toBe(true);
  });

  it('detects tampering with historical events', async () => {
    const sink = new InMemoryAuditSink();
    const logger = new AuditLogger(sink);
    await logger.record({ eventKey: 'case.open', action: 'open', actorUserId: 'u1' });
    await logger.record({ eventKey: 'document.open', action: 'open', actorUserId: 'u1' });
    await logger.record({ eventKey: 'document.download', action: 'download', actorUserId: 'u1' });

    sink.events[1] = { ...sink.events[1]!, actorUserId: 'someone-else' };
    const verification = verifyChain(sink.events);
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtIndex).toBe(1);
  });

  it('detects removed events', async () => {
    const sink = new InMemoryAuditSink();
    const logger = new AuditLogger(sink);
    await logger.record({ eventKey: 'case.open', action: 'open' });
    await logger.record({ eventKey: 'export.approved', action: 'approve' });
    await logger.record({ eventKey: 'ubm.export_sent', action: 'send' });

    sink.events.splice(1, 1);
    expect(verifyChain(sink.events).valid).toBe(false);
  });

  it('defaults outcome to success', async () => {
    const sink = new InMemoryAuditSink();
    const logger = new AuditLogger(sink);
    const event = await logger.record({ eventKey: 'case.open', action: 'open' });
    expect(event.outcome).toBe('success');
  });
});
