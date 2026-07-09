import type { RoleId } from '@ubm-klar/shared-types';

export interface NavArea {
  href: string;
  labelSv: string;
  /** Roles that see this area. Case workers never see infrastructure/admin areas. */
  roles: RoleId[];
}

export const NAV_AREAS: NavArea[] = [
  {
    href: '/',
    labelSv: 'Översikt',
    roles: [
      'municipality_admin',
      'system_owner',
      'social_services_manager',
      'lss_case_worker',
      'economic_assistance_case_worker',
      'controller',
      'finance_officer',
      'lawyer',
      'dpo',
      'information_security_officer',
      'internal_auditor',
      'ubm_export_manager',
      'control_investigator',
      'read_only_reviewer',
    ],
  },
  {
    href: '/ubm-beredskap',
    labelSv: 'UBM-beredskap',
    roles: [
      'municipality_admin',
      'system_owner',
      'social_services_manager',
      'ubm_export_manager',
      'dpo',
      'lawyer',
    ],
  },
  {
    href: '/ubm-forfragningar',
    labelSv: 'UBM-förfrågningar',
    roles: ['ubm_export_manager', 'lawyer', 'dpo', 'social_services_manager'],
  },
  {
    href: '/exportforslag',
    labelSv: 'Exportförslag',
    roles: ['ubm_export_manager', 'lawyer', 'dpo'],
  },
  {
    href: '/underrattelser',
    labelSv: 'Underrättelser',
    roles: ['ubm_export_manager', 'control_investigator', 'social_services_manager'],
  },
  {
    href: '/kontrollarenden',
    labelSv: 'Kontrollärenden',
    roles: [
      'control_investigator',
      'controller',
      'social_services_manager',
      'lawyer',
      'read_only_reviewer',
    ],
  },
  {
    href: '/lss',
    labelSv: 'LSS',
    roles: [
      'lss_case_worker',
      'social_services_manager',
      'control_investigator',
      'read_only_reviewer',
    ],
  },
  {
    href: '/ekonomiskt-bistand',
    labelSv: 'Ekonomiskt bistånd',
    roles: [
      'economic_assistance_case_worker',
      'social_services_manager',
      'control_investigator',
      'read_only_reviewer',
    ],
  },
  {
    href: '/betalningskontroll',
    labelSv: 'Betalningskontroll',
    roles: ['controller', 'finance_officer', 'control_investigator', 'social_services_manager'],
  },
  {
    href: '/importer',
    labelSv: 'Importer',
    roles: [
      'municipality_admin',
      'system_owner',
      'technical_admin_no_pii',
      'controller',
      'finance_officer',
    ],
  },
  {
    href: '/dokument',
    labelSv: 'Dokument',
    roles: [
      'lss_case_worker',
      'economic_assistance_case_worker',
      'lawyer',
      'ubm_export_manager',
      'control_investigator',
    ],
  },
  {
    href: '/rapporter',
    labelSv: 'Rapporter',
    roles: [
      'social_services_manager',
      'municipality_admin',
      'system_owner',
      'controller',
      'internal_auditor',
    ],
  },
  {
    href: '/revision',
    labelSv: 'Revision och loggar',
    roles: [
      'internal_auditor',
      'dpo',
      'information_security_officer',
      'municipality_admin',
      'system_owner',
    ],
  },
  {
    href: '/juridik',
    labelSv: 'Juridik och DPO',
    roles: ['lawyer', 'dpo'],
  },
  {
    href: '/sakerhet',
    labelSv: 'Säkerhet',
    roles: ['information_security_officer', 'system_owner', 'municipality_admin'],
  },
  {
    href: '/arkiv',
    labelSv: 'Arkiv',
    roles: ['municipality_admin', 'system_owner', 'internal_auditor'],
  },
  {
    href: '/installningar',
    labelSv: 'Inställningar',
    roles: ['municipality_admin', 'system_owner', 'technical_admin_no_pii'],
  },
];

export function navForRoles(roles: RoleId[]): NavArea[] {
  return NAV_AREAS.filter((area) => area.roles.some((r) => roles.includes(r)));
}

/**
 * Demo role used for local rendering. In production the roles come from the
 * verified SSO session; navigation is a convenience only — the backend and RLS
 * authorize every request regardless of what the frontend shows.
 */
export const DEMO_ROLES: RoleId[] = [
  'social_services_manager',
  'municipality_admin',
  'ubm_export_manager',
  'controller',
  'lawyer',
  'dpo',
  'information_security_officer',
  'internal_auditor',
  'lss_case_worker',
  'economic_assistance_case_worker',
  'control_investigator',
  'finance_officer',
  'system_owner',
];
