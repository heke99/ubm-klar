/** Context snapshot evaluated by the LSS risk rules and matching engine. */

export interface LssDecisionCtx {
  id: string;
  personId: string;
  status: 'active' | 'expired' | 'terminated' | 'superseded' | 'appealed';
  periodStart: string;
  periodEnd?: string;
  hoursPerWeek: number;
}

export interface LssTimeReportRowCtx {
  assistantId: string;
  workDate: string;
  /** 0-24 decimal hours */
  startHour: number;
  endHour: number;
  hours: number;
}

export interface LssTimeReportCtx {
  id: string;
  personId: string;
  providerId: string;
  decisionId?: string;
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  approved: boolean;
  rows: LssTimeReportRowCtx[];
}

export interface LssInvoiceCtx {
  id: string;
  providerId: string;
  invoiceOrgNumber?: string;
  personId: string;
  decisionId?: string;
  periodStart: string;
  periodEnd: string;
  totalHours?: number;
  totalAmountSek: number;
  status: 'received' | 'validated' | 'approved' | 'rejected' | 'paid' | 'credited';
}

export interface LssPaymentCtx {
  id: string;
  personId?: string;
  providerId?: string;
  invoiceId?: string;
  decisionId?: string;
  batchId?: string;
  amountSek: number;
  paymentDate: string;
  status: string;
  recipientOrganizationId?: string;
  recipientAccountReference?: string;
}

export interface LssProviderCtx {
  id: string;
  organizationId: string;
  orgNumber: string;
  status: 'active' | 'suspended' | 'under_review' | 'terminated';
  contractedOrgNumbers: string[];
  ivoPermits: Array<{
    status: 'active' | 'expired' | 'revoked' | 'pending';
    validFrom: string;
    validTo?: string;
  }>;
  contracts: Array<{
    status: 'active' | 'expired' | 'terminated';
    validFrom: string;
    validTo?: string;
  }>;
  approvedAccountReferences: string[];
  riskFlags: Array<{ flagKind: string; manuallyReviewed: boolean }>;
  lastAccountChangeAt?: string;
}

export interface LssProtectedPersonCtx {
  personId: string;
  protectedIdentity: boolean;
  hasElevatedAccessProtection: boolean;
}

export interface LssDocumentCtx {
  id: string;
  personId?: string;
  documentType: string;
  documentClass:
    | 'standard'
    | 'sensitive'
    | 'medical'
    | 'protected_identity'
    | 'children'
    | 'disclosure'
    | 'archive';
}

export interface LssDocumentAccessCtx {
  documentId: string;
  documentClass: LssDocumentCtx['documentClass'];
  actorUserId: string;
  reasonRecorded: boolean;
}

export interface LssPaymentFileRowCtx {
  id: string;
  recipientOrgNumber?: string;
  recipientAccountReference?: string;
  amountSek: number;
  paymentDate: string;
}

export interface LssPaymentBatchCtx {
  id: string;
  scheduledDate?: string;
  status: string;
  recipientProviderIds: string[];
  recipientPersonIds: string[];
}

export interface LssRecoveryClaimCtx {
  id: string;
  personId?: string;
  providerId?: string;
  status: 'open' | 'partially_recovered' | 'recovered' | 'written_off' | 'disputed' | 'closed';
}

export interface LssRuleContext {
  decisions: LssDecisionCtx[];
  timeReports: LssTimeReportCtx[];
  invoices: LssInvoiceCtx[];
  payments: LssPaymentCtx[];
  providers: LssProviderCtx[];
  protectedPersons: LssProtectedPersonCtx[];
  documents: LssDocumentCtx[];
  documentAccessEvents: LssDocumentAccessCtx[];
  paymentFileRows: LssPaymentFileRowCtx[];
  paymentBatches: LssPaymentBatchCtx[];
  recoveryClaims: LssRecoveryClaimCtx[];
  /** Days before payment where an account change is suspicious. */
  accountChangeWindowDays?: number;
}

export function emptyLssContext(): LssRuleContext {
  return {
    decisions: [],
    timeReports: [],
    invoices: [],
    payments: [],
    providers: [],
    protectedPersons: [],
    documents: [],
    documentAccessEvents: [],
    paymentFileRows: [],
    paymentBatches: [],
    recoveryClaims: [],
  };
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function weeksInPeriod(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime() + DAY_MS) / (7 * DAY_MS);
}

export function periodsOverlap(
  aStart: string,
  aEnd: string | undefined,
  bStart: string,
  bEnd: string | undefined,
): boolean {
  const aE = aEnd ?? '9999-12-31';
  const bE = bEnd ?? '9999-12-31';
  return aStart <= bE && bStart <= aE;
}
