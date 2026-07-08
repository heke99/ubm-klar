import { requiresRevealReason, type DataClass } from '@ubm-klar/shared-types';

export interface RevealRequest {
  userId: string;
  entityKind: string;
  entityId: string;
  fieldKey: string;
  dataClass: DataClass;
  reason?: string;
}

export interface RevealDecision {
  allowed: boolean;
  mustLog: boolean;
  error?: string;
}

/** Minimum meaningful length for a reveal reason (matches DB constraint). */
export const MIN_REASON_LENGTH = 10;

/**
 * Reason-required reveal of masked sensitive fields. The caller must already
 * hold `person.sensitive_field.reveal` (checked by access-control); this adds
 * the internal-secrecy contract: reason quality + mandatory logging.
 */
export function evaluateReveal(request: RevealRequest): RevealDecision {
  if (!requiresRevealReason(request.dataClass)) {
    return { allowed: true, mustLog: true };
  }
  const reason = request.reason?.trim() ?? '';
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      allowed: false,
      mustLog: false,
      error: `Fältet är maskerat. Ange skäl (minst ${MIN_REASON_LENGTH} tecken) för att visa uppgiften.`,
    };
  }
  return { allowed: true, mustLog: true };
}

/** Masks a value for display; used by API serializers for masked-by-default fields. */
export function maskValue(value: string | null | undefined, dataClass: DataClass): string {
  if (value === null || value === undefined || value === '') return '';
  switch (dataClass) {
    case 'bank_account_payment_recipient':
      return value.length > 4 ? `••••${value.slice(-4)}` : '••••';
    case 'personal_data':
      // personnummer style: keep century+year only
      return value.length >= 4 ? `${value.slice(0, 4)}••••••••` : '••••';
    default:
      return '••••••';
  }
}
