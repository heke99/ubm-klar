/** Context snapshot evaluated by the economic assistance risk rules. */

export interface EaDecisionCtx {
  id: string;
  householdId: string;
  applicationId?: string;
  decisionKind: 'approval' | 'partial_approval' | 'rejection' | 'reconsideration' | 'termination';
  status: 'active' | 'superseded' | 'terminated' | 'under_reconsideration' | 'appealed';
  periodStart: string;
  periodEnd: string;
  approvedAmountSek: number;
  decidedAt: string;
  /** Account reference registered at decision time. */
  accountReferenceAtDecision?: string;
}

export interface EaApplicationCtx {
  id: string;
  householdId: string;
  periodStart?: string;
  periodEnd?: string;
  requiredDocumentRoles: string[];
  attachedDocumentRoles: string[];
}

export interface EaPaymentCtx {
  id: string;
  decisionId?: string;
  householdId?: string;
  personId?: string;
  amountSek: number;
  paymentDate: string;
  status: string;
  accountReference?: string;
  recipientKind?: 'applicant' | 'household_member' | 'landlord' | 'other_verified';
  recipientPersonId?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface EaIncomeCtx {
  id: string;
  kind: 'declared' | 'verified';
  applicationId?: string;
  personId: string;
  amountSek: number;
  periodStart?: string;
  periodEnd?: string;
  usedInDecision: boolean;
  verifiedAt?: string;
}

export interface EaHouseholdCtx {
  id: string;
  memberPersonIds: string[];
  protectedIdentity: boolean;
  elevatedAccessProtection: boolean;
  accountReferences: string[];
  lastAccountChangeAt?: string;
  membersChangedAfterDecision?: boolean;
}

export interface EaHousingCtx {
  id: string;
  householdId: string;
  monthlyCostSek?: number;
  hasContractDocument: boolean;
  hasCostDocumentLink: boolean;
}

export interface EaCalculationCtx {
  id: string;
  applicationId: string;
  decisionId?: string;
  includedPersonIds: string[];
  usedDeclaredIncomeOnly: boolean;
  totalIncomeSek: number;
}

export interface EaRecoveryClaimCtx {
  id: string;
  householdId?: string;
  personId?: string;
  status: 'open' | 'partially_recovered' | 'recovered' | 'written_off' | 'disputed' | 'closed';
  controlPerformedForNewPayments: boolean;
}

export interface EaPaymentFileRowCtx {
  id: string;
  householdId?: string;
  accountReference?: string;
  amountSek: number;
  paymentDate: string;
  matchedDecisionId?: string;
}

export interface EaSensitiveRevealCtx {
  entityId: string;
  fieldKey: string;
  actorUserId: string;
  reasonRecorded: boolean;
}

export interface EaRuleContext {
  decisions: EaDecisionCtx[];
  applications: EaApplicationCtx[];
  payments: EaPaymentCtx[];
  incomes: EaIncomeCtx[];
  households: EaHouseholdCtx[];
  housingRecords: EaHousingCtx[];
  calculations: EaCalculationCtx[];
  recoveryClaims: EaRecoveryClaimCtx[];
  paymentFileRows: EaPaymentFileRowCtx[];
  sensitiveReveals: EaSensitiveRevealCtx[];
  accountChangeWindowDays?: number;
}

export function emptyEaContext(): EaRuleContext {
  return {
    decisions: [],
    applications: [],
    payments: [],
    incomes: [],
    households: [],
    housingRecords: [],
    calculations: [],
    recoveryClaims: [],
    paymentFileRows: [],
    sensitiveReveals: [],
  };
}
