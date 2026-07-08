export type OnboardingStage =
  | 'organisation'
  | 'deployment'
  | 'authentication'
  | 'source_systems'
  | 'data_mapping'
  | 'payment_control'
  | 'ubm_readiness'
  | 'go_live';

export interface OnboardingStepDefinition {
  stage: OnboardingStage;
  stepKey: string;
  titleSv: string;
  required: boolean;
}

/** The guided onboarding program (8 stages). */
export const ONBOARDING_STEPS: OnboardingStepDefinition[] = [
  // 1. Organisation
  { stage: 'organisation', stepKey: 'org_municipality_profile', titleSv: 'Kommunprofil registrerad', required: true },
  { stage: 'organisation', stepKey: 'org_committees_departments_units', titleSv: 'Nämnder, förvaltningar och enheter upplagda', required: true },
  { stage: 'organisation', stepKey: 'org_responsible_owners', titleSv: 'Ansvariga ägare utsedda', required: true },
  { stage: 'organisation', stepKey: 'org_dpo', titleSv: 'Dataskyddsombud registrerat', required: true },
  { stage: 'organisation', stepKey: 'org_security_officer', titleSv: 'Informationssäkerhetsansvarig registrerad', required: true },
  { stage: 'organisation', stepKey: 'org_system_owner', titleSv: 'Systemägare registrerad', required: true },
  { stage: 'organisation', stepKey: 'org_ubm_contact', titleSv: 'UBM-kontakt registrerad', required: true },
  { stage: 'organisation', stepKey: 'org_legal_contact', titleSv: 'Juridisk kontakt registrerad', required: true },
  { stage: 'organisation', stepKey: 'org_finance_contact', titleSv: 'Ekonomikontakt registrerad', required: true },
  // 2. Deployment
  { stage: 'deployment', stepKey: 'dep_model_selected', titleSv: 'Driftmodell vald (Modell B eller C)', required: true },
  { stage: 'deployment', stepKey: 'dep_domains_configured', titleSv: 'Domäner konfigurerade och verifierade', required: true },
  { stage: 'deployment', stepKey: 'dep_environments', titleSv: 'Test-, stage- och produktionsmiljöer skapade', required: true },
  { stage: 'deployment', stepKey: 'dep_storage', titleSv: 'Lagring/dokumentbuckets konfigurerade', required: true },
  { stage: 'deployment', stepKey: 'dep_keys', titleSv: 'Nycklar/nyckelreferenser konfigurerade', required: true },
  { stage: 'deployment', stepKey: 'dep_backup_restore', titleSv: 'Backup och återläsning konfigurerad', required: true },
  { stage: 'deployment', stepKey: 'dep_siem', titleSv: 'SIEM-export konfigurerad', required: false },
  { stage: 'deployment', stepKey: 'dep_support_model', titleSv: 'Supportåtkomstmodell fastställd', required: true },
  // 3. Authentication
  { stage: 'authentication', stepKey: 'auth_idp_configured', titleSv: 'Entra/OIDC/SAML konfigurerad', required: true },
  { stage: 'authentication', stepKey: 'auth_mfa_verified', titleSv: 'MFA verifierad', required: true },
  { stage: 'authentication', stepKey: 'auth_group_mapping', titleSv: 'Gruppmappning konfigurerad', required: true },
  { stage: 'authentication', stepKey: 'auth_role_mapping', titleSv: 'Rollmappning konfigurerad', required: true },
  { stage: 'authentication', stepKey: 'auth_break_glass', titleSv: 'Break glass-konton upplagda', required: true },
  // 4. Source systems
  { stage: 'source_systems', stepKey: 'src_lss_inventory', titleSv: 'LSS-system inventerat', required: true },
  { stage: 'source_systems', stepKey: 'src_ea_inventory', titleSv: 'System för ekonomiskt bistånd inventerat', required: true },
  { stage: 'source_systems', stepKey: 'src_economy_inventory', titleSv: 'Ekonomi-/betalsystem inventerat', required: true },
  { stage: 'source_systems', stepKey: 'src_document_systems', titleSv: 'Dokumentsystem inventerade', required: true },
  { stage: 'source_systems', stepKey: 'src_archive_systems', titleSv: 'Arkivsystem inventerade', required: false },
  { stage: 'source_systems', stepKey: 'src_import_methods', titleSv: 'Importmetoder fastställda', required: true },
  { stage: 'source_systems', stepKey: 'src_owners', titleSv: 'Systemägare per källsystem utsedda', required: true },
  { stage: 'source_systems', stepKey: 'src_data_quality_status', titleSv: 'Datakvalitetsstatus bedömd', required: true },
  // 5. Data mapping
  { stage: 'data_mapping', stepKey: 'map_fields', titleSv: 'Fältmappning genomförd', required: true },
  { stage: 'data_mapping', stepKey: 'map_source_records', titleSv: 'Källpostlänkar upprättade', required: true },
  { stage: 'data_mapping', stepKey: 'map_canonical_model', titleSv: 'Kanonisk modell fastställd', required: true },
  { stage: 'data_mapping', stepKey: 'map_system_of_record', titleSv: 'System of record definierat', required: true },
  { stage: 'data_mapping', stepKey: 'map_legal_basis', titleSv: 'Rättslig grund dokumenterad', required: true },
  { stage: 'data_mapping', stepKey: 'map_purpose', titleSv: 'Ändamål dokumenterade', required: true },
  { stage: 'data_mapping', stepKey: 'map_retention', titleSv: 'Gallringsregler kopplade', required: true },
  { stage: 'data_mapping', stepKey: 'map_classification', titleSv: 'Informationsklassning genomförd', required: true },
  { stage: 'data_mapping', stepKey: 'map_export_eligibility', titleSv: 'Exportbarhet bedömd', required: true },
  // 6. Payment control
  { stage: 'payment_control', stepKey: 'pay_files', titleSv: 'Betalningsfiler konfigurerade', required: true },
  { stage: 'payment_control', stepKey: 'pay_recipients', titleSv: 'Mottagarregister upprättat', required: true },
  { stage: 'payment_control', stepKey: 'pay_account_references', titleSv: 'Bankgiro/plusgiro/kontoreferenser registrerade', required: true },
  { stage: 'payment_control', stepKey: 'pay_decision_matching', titleSv: 'Beslut-betalningsmatchning konfigurerad', required: true },
  { stage: 'payment_control', stepKey: 'pay_reconciliation', titleSv: 'Avstämning testad', required: true },
  { stage: 'payment_control', stepKey: 'pay_risk_rules', titleSv: 'Riskregler aktiverade', required: true },
  // 7. UBM readiness
  { stage: 'ubm_readiness', stepKey: 'ubm_request_mode', titleSv: 'Förfrågningshantering konfigurerad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_proposal_mode', titleSv: 'Exportförslagsläge konfigurerat', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_notification_mode', titleSv: 'Underrättelsehantering konfigurerad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_legal_review', titleSv: 'Juridisk granskning konfigurerad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_dpo_review', titleSv: 'DPO-granskning konfigurerad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_maker_checker', titleSv: 'Maker-checker aktiverad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_receipt_handling', titleSv: 'Kvittenshantering konfigurerad', required: true },
  { stage: 'ubm_readiness', stepKey: 'ubm_evidence_chain', titleSv: 'Beviskedja aktiverad', required: true },
  // 8. Go-live
  { stage: 'go_live', stepKey: 'gl_dpia', titleSv: 'DPIA genomförd', required: true },
  { stage: 'go_live', stepKey: 'gl_pub_dpa', titleSv: 'PUB-avtal/DPA signerat', required: true },
  { stage: 'go_live', stepKey: 'gl_security_review', titleSv: 'Säkerhetsgranskning genomförd', required: true },
  { stage: 'go_live', stepKey: 'gl_rls_tests', titleSv: 'RLS-tester godkända', required: true },
  { stage: 'go_live', stepKey: 'gl_sso_test', titleSv: 'SSO-test godkänt', required: true },
  { stage: 'go_live', stepKey: 'gl_backup_test', titleSv: 'Backuptest godkänt', required: true },
  { stage: 'go_live', stepKey: 'gl_restore_test', titleSv: 'Återläsningstest godkänt', required: true },
  { stage: 'go_live', stepKey: 'gl_accessibility_review', titleSv: 'Tillgänglighetsgranskning genomförd', required: true },
  { stage: 'go_live', stepKey: 'gl_exit_export_test', titleSv: 'Exit-exporttest godkänt', required: true },
  { stage: 'go_live', stepKey: 'gl_ubm_mock_request', titleSv: 'UBM-testförfrågan genomförd', required: true },
  { stage: 'go_live', stepKey: 'gl_ubm_mock_export', titleSv: 'UBM-testexport genomförd', required: true },
  { stage: 'go_live', stepKey: 'gl_payment_reconciliation_test', titleSv: 'Betalningsavstämningstest godkänt', required: true },
  { stage: 'go_live', stepKey: 'gl_final_approval', titleSv: 'Slutligt godkännande (maker-checker)', required: true },
];

export type StepStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'skipped'
  | 'not_applicable';

export type ReadinessScoreKey =
  | 'ubm_readiness'
  | 'data_quality'
  | 'source_system_mapping'
  | 'payment_control_readiness'
  | 'legal_dpo_readiness'
  | 'security_readiness'
  | 'archive_readiness'
  | 'production_readiness';

const SCORE_STAGES: Record<ReadinessScoreKey, OnboardingStage[]> = {
  ubm_readiness: ['ubm_readiness'],
  data_quality: ['data_mapping'],
  source_system_mapping: ['source_systems', 'data_mapping'],
  payment_control_readiness: ['payment_control'],
  legal_dpo_readiness: ['organisation', 'ubm_readiness'],
  security_readiness: ['authentication', 'deployment'],
  archive_readiness: ['data_mapping'],
  production_readiness: [
    'organisation',
    'deployment',
    'authentication',
    'source_systems',
    'data_mapping',
    'payment_control',
    'ubm_readiness',
    'go_live',
  ],
};

export interface ReadinessScore {
  scoreKey: ReadinessScoreKey;
  score: number;
  completedRequired: number;
  totalRequired: number;
  blockers: string[];
}

export function computeReadinessScores(
  progress: Record<string, StepStatus>,
  steps: OnboardingStepDefinition[] = ONBOARDING_STEPS,
): ReadinessScore[] {
  return (Object.keys(SCORE_STAGES) as ReadinessScoreKey[]).map((scoreKey) => {
    const stages = SCORE_STAGES[scoreKey];
    const relevant = steps.filter((s) => stages.includes(s.stage) && s.required);
    const completed = relevant.filter((s) => {
      const status = progress[s.stepKey] ?? 'not_started';
      return status === 'completed' || status === 'not_applicable';
    });
    const blockers = relevant
      .filter((s) => (progress[s.stepKey] ?? 'not_started') === 'blocked')
      .map((s) => s.stepKey);
    return {
      scoreKey,
      score: relevant.length === 0 ? 100 : Math.round((completed.length / relevant.length) * 100),
      completedRequired: completed.length,
      totalRequired: relevant.length,
      blockers,
    };
  });
}

export interface Recommendation {
  scoreKey: ReadinessScoreKey;
  recommendationSv: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export function buildRecommendations(scores: ReadinessScore[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  for (const score of scores) {
    if (score.blockers.length > 0) {
      recommendations.push({
        scoreKey: score.scoreKey,
        recommendationSv: `Lös blockerande steg: ${score.blockers.join(', ')}.`,
        priority: 'critical',
      });
    }
    if (score.score < 50) {
      recommendations.push({
        scoreKey: score.scoreKey,
        recommendationSv: `Området ${score.scoreKey} är under 50 % klart (${score.score} %). Prioritera de återstående obligatoriska stegen.`,
        priority: 'high',
      });
    } else if (score.score < 100) {
      recommendations.push({
        scoreKey: score.scoreKey,
        recommendationSv: `Slutför återstående steg inom ${score.scoreKey} (${score.completedRequired}/${score.totalRequired} klara).`,
        priority: 'medium',
      });
    }
  }
  return recommendations;
}

/** Go-live is only possible when production readiness is 100% and nothing is blocked. */
export function isGoLiveReady(scores: ReadinessScore[]): { ready: boolean; reason: string } {
  const production = scores.find((s) => s.scoreKey === 'production_readiness');
  if (!production) return { ready: false, reason: 'Produktionsberedskap är inte beräknad.' };
  if (production.blockers.length > 0) {
    return { ready: false, reason: `Blockerande steg: ${production.blockers.join(', ')}` };
  }
  if (production.score < 100) {
    return {
      ready: false,
      reason: `Endast ${production.completedRequired} av ${production.totalRequired} obligatoriska steg är klara.`,
    };
  }
  return { ready: true, reason: 'Alla obligatoriska steg är klara.' };
}
