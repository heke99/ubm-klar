import { isPhaseActive, type UbmPhaseConfiguration } from '@ubm-klar/legal-source-engine';

export type UbmRequestStatus =
  | 'received'
  | 'registered'
  | 'validated'
  | 'matching'
  | 'data_collection'
  | 'eligibility_review'
  | 'proposal_created'
  | 'in_review'
  | 'approved'
  | 'exported'
  | 'receipt_received'
  | 'closed'
  | 'rejected';

export type UbmIntakeChannel =
  | 'manual_registration'
  | 'file_upload'
  | 'api_webhook'
  | 'email_intake'
  | 'official_transport';

/**
 * Intake channels usable today. API/webhook and email intake are placeholders,
 * and the official UBM transport must never be assumed to exist before
 * credentials/specifications are provided.
 */
export const ENABLED_INTAKE_CHANNELS: readonly UbmIntakeChannel[] = [
  'manual_registration',
  'file_upload',
] as const;

export const REQUEST_STATUS_TRANSITIONS: Record<UbmRequestStatus, UbmRequestStatus[]> = {
  received: ['registered', 'rejected'],
  registered: ['validated', 'rejected'],
  validated: ['matching'],
  matching: ['data_collection', 'rejected'],
  data_collection: ['eligibility_review'],
  eligibility_review: ['proposal_created', 'rejected'],
  proposal_created: ['in_review'],
  in_review: ['approved', 'eligibility_review', 'rejected'],
  approved: ['exported'],
  exported: ['receipt_received'],
  receipt_received: ['closed'],
  closed: [],
  rejected: [],
};

export class InvalidRequestTransitionError extends Error {
  constructor(from: UbmRequestStatus, to: UbmRequestStatus) {
    super(`Invalid UBM request transition: ${from} -> ${to}`);
    this.name = 'InvalidRequestTransitionError';
  }
}

export interface UbmRequestValidationInput {
  requestNumber: string;
  intakeChannel: UbmIntakeChannel;
  receivedAt: string;
  phases: UbmPhaseConfiguration[];
  featureFlags: Record<string, boolean>;
  hasSubject: boolean;
  hasRequestedItems: boolean;
}

export interface UbmRequestValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateUbmRequest(input: UbmRequestValidationInput): UbmRequestValidationResult {
  const errors: string[] = [];
  if (!ENABLED_INTAKE_CHANNELS.includes(input.intakeChannel)) {
    errors.push(
      `Intagskanalen "${input.intakeChannel}" är inte aktiverad. Officiell UBM-transport får inte antas existera utan specifikation.`,
    );
  }
  const phase1 = isPhaseActive(
    { phases: input.phases, featureFlags: input.featureFlags, atDate: input.receivedAt.slice(0, 10) },
    'phase_1_request_based_2026',
  );
  if (!phase1.active) {
    errors.push(`Fas 1 (förfrågningsbaserad) är inte aktiv: ${phase1.reason}`);
  }
  if (!input.requestNumber.trim()) {
    errors.push('Förfrågan saknar ärendenummer.');
  }
  if (!input.hasSubject) {
    errors.push('Förfrågan saknar angiven person eller organisation.');
  }
  if (!input.hasRequestedItems) {
    errors.push('Förfrågan saknar specificerade uppgifter.');
  }
  return { valid: errors.length === 0, errors };
}

export function transitionRequest(
  currentStatus: UbmRequestStatus,
  to: UbmRequestStatus,
): UbmRequestStatus {
  const allowed = REQUEST_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidRequestTransitionError(currentStatus, to);
  }
  return to;
}
