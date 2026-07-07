/** Product modules that can be enabled per tenant via entitlements. */
export type ModuleId =
  | 'platform_foundation'
  | 'municipal_data_plane'
  | 'ubm_readiness'
  | 'payment_control'
  | 'lss'
  | 'economic_assistance'
  | 'import_gateway'
  | 'document_vault'
  | 'data_quality'
  | 'control_cases'
  | 'compliance_legal'
  | 'cybersecurity'
  | 'archive'
  | 'accessibility'
  | 'commercial_platform';

export const ALL_MODULES: readonly ModuleId[] = [
  'platform_foundation',
  'municipal_data_plane',
  'ubm_readiness',
  'payment_control',
  'lss',
  'economic_assistance',
  'import_gateway',
  'document_vault',
  'data_quality',
  'control_cases',
  'compliance_legal',
  'cybersecurity',
  'archive',
  'accessibility',
  'commercial_platform',
] as const;
