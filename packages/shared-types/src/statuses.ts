/** Lifecycle statuses for legal sources, obligations, schemas and rules. */
export type RegistryStatus =
  | 'draft'
  | 'proposed'
  | 'pilot'
  | 'active'
  | 'deprecated'
  | 'superseded'
  | 'requires_manual_review'
  | 'awaiting_official_specification';

export const REGISTRY_STATUSES: readonly RegistryStatus[] = [
  'draft',
  'proposed',
  'pilot',
  'active',
  'deprecated',
  'superseded',
  'requires_manual_review',
  'awaiting_official_specification',
] as const;

/** Statuses that permit production use of a schema/obligation/rule version. */
export const USABLE_REGISTRY_STATUSES: readonly RegistryStatus[] = ['pilot', 'active'] as const;

export type PaymentStatus =
  | 'created'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'paid'
  | 'rejected'
  | 'reversed'
  | 'paused'
  | 'cancelled'
  | 'stopped'
  | 'recovery_started';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'created',
  'pending_approval',
  'approved',
  'sent',
  'paid',
  'rejected',
  'reversed',
  'paused',
  'cancelled',
  'stopped',
  'recovery_started',
] as const;

export type DataQualityStatus =
  | 'valid'
  | 'valid_with_warning'
  | 'blocked'
  | 'requires_manual_review'
  | 'requires_legal_review'
  | 'requires_dpo_review'
  | 'requires_classification_review'
  | 'requires_lineage_fix'
  | 'requires_source_system_fix'
  | 'requires_mapping_fix';

export type UbmEligibilityOutcome =
  | 'send_allowed'
  | 'send_allowed_after_review'
  | 'do_not_send'
  | 'requires_redaction'
  | 'requires_legal_review'
  | 'requires_dpo_review'
  | 'requires_manual_review'
  | 'requires_maker_checker'
  | 'requires_data_lineage_fix'
  | 'requires_classification_review'
  | 'requires_source_system_fix'
  | 'requires_schema_update'
  | 'requires_transport_configuration';

export type RiskSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ControlCaseStatus =
  'open' | 'assigned' | 'investigating' | 'awaiting_decision' | 'decided' | 'closed' | 'reopened';

export type ApprovalDecision = 'approved' | 'rejected' | 'returned_for_changes';
