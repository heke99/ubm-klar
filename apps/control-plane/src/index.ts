export type DeploymentMode = 'model_b_vendor_hosted_isolated' | 'model_c1_municipality_supabase' | 'model_c2_self_hosted_supabase' | 'model_c3_postgres_separate_storage';

export type ControlPlaneTenant = {
  id: string;
  name: string;
  slug: string;
  orgNumber: string;
  deploymentMode: DeploymentMode;
  status: 'prospect' | 'onboarding' | 'test' | 'stage' | 'prod' | 'suspended';
  piiAllowed: false;
};

export const CONTROL_PLANE_PII_POLICY = {
  storesCitizenPersonalData: false,
  storesDocuments: false,
  storesUbmPayloads: false,
  storesCaseNotes: false,
};
