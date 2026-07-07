export type Environment = 'test' | 'stage' | 'prod';

export type ModuleCode =
  | 'ubm'
  | 'lss'
  | 'economic_assistance'
  | 'payment_control'
  | 'documents'
  | 'archive'
  | 'compliance'
  | 'security'
  | 'support';

export type DataClassification =
  | 'public'
  | 'internal'
  | 'confidential'
  | 'strictly_confidential'
  | 'protected_identity'
  | 'medical'
  | 'children'
  | 'income'
  | 'payment_recipient';

export type UBMPhase = 'request_based_2026' | 'recurring_reporting_2029';

export type ReviewStatus =
  | 'not_started'
  | 'requires_manual_review'
  | 'requires_legal_review'
  | 'requires_dpo_review'
  | 'requires_maker_checker'
  | 'approved'
  | 'rejected';
