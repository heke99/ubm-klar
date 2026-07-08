/** Well-known feature flags. Tenant-level values live in the control plane. */
export const FEATURE_FLAGS = {
  /** UBM Phase 2 recurring reporting (2029). Off until official specifications exist. */
  UBM_RECURRING_REPORTING_2029: 'ubm_recurring_reporting_2029',
  /** AI assistance features (always suggestion-only). */
  AI_ASSISTANCE: 'ai_assistance',
  /** Allow Supabase Auth fallback in this environment (never primary in prod). */
  SUPABASE_AUTH_FALLBACK: 'supabase_auth_fallback',
  /** SIEM export of no-PII technical events. */
  SIEM_EXPORT: 'siem_export',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export const DEFAULT_FLAG_VALUES: Record<FeatureFlagKey, boolean> = {
  ubm_recurring_reporting_2029: false,
  ai_assistance: false,
  supabase_auth_fallback: false,
  siem_export: false,
};

export function isFlagEnabled(
  flags: Record<string, boolean> | undefined,
  key: FeatureFlagKey,
): boolean {
  return flags?.[key] ?? DEFAULT_FLAG_VALUES[key] ?? false;
}
