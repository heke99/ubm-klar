import { scanForPii } from '@ubm-klar/config';

export type DataAccessKind =
  | 'person_search'
  | 'person_record_open'
  | 'case_open'
  | 'document_open'
  | 'document_download'
  | 'medical_data_view'
  | 'protected_identity_view'
  | 'children_data_view'
  | 'income_view'
  | 'bank_account_view'
  | 'sensitive_field_reveal'
  | 'export_view'
  | 'support_access'
  | 'break_glass_access';

/** Access kinds that must always carry a reason. */
export const REASON_REQUIRED_ACCESS_KINDS: readonly DataAccessKind[] = [
  'medical_data_view',
  'protected_identity_view',
  'children_data_view',
  'sensitive_field_reveal',
  'break_glass_access',
] as const;

export interface DataAccessEvent {
  actorUserId: string;
  actorRole?: string;
  accessKind: DataAccessKind;
  personId?: string;
  caseKind?: string;
  caseId?: string;
  documentId?: string;
  fieldKey?: string;
  reason?: string;
  purpose?: string;
  sessionKind: 'normal' | 'support_jit' | 'break_glass';
  occurredAt: string;
}

export interface DataAccessSink {
  append(event: DataAccessEvent): Promise<void>;
}

export class MissingAccessReasonError extends Error {
  constructor(kind: DataAccessKind) {
    super(`Data access of kind "${kind}" requires a recorded reason`);
    this.name = 'MissingAccessReasonError';
  }
}

/**
 * Data access logger for the municipal data plane. Stores references (ids),
 * never data content. Lives in the tenant's own database — the vendor
 * never receives these events.
 */
export class DataAccessLogger {
  constructor(
    private readonly sink: DataAccessSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async record(input: Omit<DataAccessEvent, 'occurredAt'>): Promise<DataAccessEvent> {
    if (REASON_REQUIRED_ACCESS_KINDS.includes(input.accessKind) && !input.reason?.trim()) {
      throw new MissingAccessReasonError(input.accessKind);
    }
    const event: DataAccessEvent = { ...input, occurredAt: this.clock().toISOString() };
    await this.sink.append(event);
    return event;
  }
}

export interface TechnicalLogEvent {
  level: 'debug' | 'info' | 'warn' | 'error';
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export class PiiInTechnicalLogError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Technical log event contains PII-like content: ${violations.join('; ')}`);
    this.name = 'PiiInTechnicalLogError';
  }
}

/**
 * No-PII technical logging helper: everything destined for vendor telemetry,
 * SIEM export or support bundles goes through this and is rejected if it
 * contains anything PII-like.
 */
export function sanitizeTechnicalLogEvent(event: TechnicalLogEvent): TechnicalLogEvent {
  const scan = scanForPii(event, 'technical-log');
  if (!scan.clean) {
    throw new PiiInTechnicalLogError(scan.violations);
  }
  return event;
}

export class InMemoryDataAccessSink implements DataAccessSink {
  readonly events: DataAccessEvent[] = [];

  async append(event: DataAccessEvent): Promise<void> {
    this.events.push(event);
  }
}
