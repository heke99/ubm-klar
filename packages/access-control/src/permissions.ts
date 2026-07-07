import type { ModuleId, RoleId } from '@ubm-klar/shared-types';

export type PermissionKey =
  | 'person.read'
  | 'person.search'
  | 'person.sensitive_field.reveal'
  | 'case.lss.read'
  | 'case.lss.write'
  | 'case.ea.read'
  | 'case.ea.write'
  | 'case.control.read'
  | 'case.control.write'
  | 'case.control.decide'
  | 'payment.read'
  | 'payment.reconcile'
  | 'payment.recipient.change'
  | 'import.run'
  | 'import.configure'
  | 'document.read'
  | 'document.download'
  | 'document.redact'
  | 'document.export.approve'
  | 'ubm.request.register'
  | 'ubm.request.read'
  | 'ubm.proposal.create'
  | 'ubm.proposal.review'
  | 'ubm.export.approve'
  | 'ubm.export.send'
  | 'ubm.notification.handle'
  | 'audit.read'
  | 'access_log.read'
  | 'legal.review'
  | 'dpo.review'
  | 'archive.manage'
  | 'archive.export'
  | 'public_record.handle'
  | 'secrecy.review'
  | 'retention.execute'
  | 'exit_export.run'
  | 'users.manage'
  | 'roles.manage'
  | 'rules.configure'
  | 'integrations.configure'
  | 'readiness.manage'
  | 'support.technical_status.read'
  | 'billing.read'
  | 'platform.tenants.manage'
  | 'break_glass.initiate';

/** Permissions that always involve citizen personal data. */
export const PII_PERMISSIONS: readonly PermissionKey[] = [
  'person.read',
  'person.search',
  'person.sensitive_field.reveal',
  'case.lss.read',
  'case.lss.write',
  'case.ea.read',
  'case.ea.write',
  'case.control.read',
  'case.control.write',
  'case.control.decide',
  'payment.read',
  'payment.reconcile',
  'payment.recipient.change',
  'document.read',
  'document.download',
  'document.redact',
  'ubm.request.read',
  'ubm.proposal.create',
  'ubm.proposal.review',
  'ubm.export.approve',
  'ubm.export.send',
  'ubm.notification.handle',
  'public_record.handle',
  'secrecy.review',
  'exit_export.run',
] as const;

/** Role → permission matrix. Backend + RLS enforce this; the frontend only mirrors it. */
export const ROLE_PERMISSIONS: Record<RoleId, readonly PermissionKey[]> = {
  municipality_admin: [
    'users.manage',
    'roles.manage',
    'integrations.configure',
    'import.configure',
    'rules.configure',
    'readiness.manage',
    'audit.read',
    'access_log.read',
  ],
  system_owner: [
    'users.manage',
    'roles.manage',
    'integrations.configure',
    'rules.configure',
    'readiness.manage',
    'audit.read',
    'access_log.read',
  ],
  social_services_manager: [
    'person.read',
    'person.search',
    'case.lss.read',
    'case.ea.read',
    'case.control.read',
    'payment.read',
    'audit.read',
  ],
  lss_case_worker: [
    'person.read',
    'person.search',
    'person.sensitive_field.reveal',
    'case.lss.read',
    'case.lss.write',
    'document.read',
  ],
  economic_assistance_case_worker: [
    'person.read',
    'person.search',
    'person.sensitive_field.reveal',
    'case.ea.read',
    'case.ea.write',
    'document.read',
  ],
  controller: [
    'person.read',
    'person.search',
    'payment.read',
    'payment.reconcile',
    'case.control.read',
    'case.control.write',
    'import.run',
  ],
  finance_officer: ['payment.read', 'payment.reconcile', 'payment.recipient.change', 'import.run'],
  lawyer: ['legal.review', 'ubm.proposal.review', 'secrecy.review', 'public_record.handle', 'case.control.read', 'document.read'],
  dpo: ['dpo.review', 'audit.read', 'access_log.read', 'ubm.proposal.review'],
  information_security_officer: ['audit.read', 'access_log.read', 'readiness.manage'],
  internal_auditor: ['audit.read', 'access_log.read'],
  ubm_export_manager: [
    'ubm.request.register',
    'ubm.request.read',
    'ubm.proposal.create',
    'ubm.proposal.review',
    'ubm.export.approve',
    'ubm.export.send',
    'ubm.notification.handle',
    'document.export.approve',
  ],
  control_investigator: [
    'person.read',
    'person.search',
    'person.sensitive_field.reveal',
    'case.control.read',
    'case.control.write',
    'case.control.decide',
    'payment.read',
    'document.read',
  ],
  read_only_reviewer: ['case.lss.read', 'case.ea.read', 'case.control.read', 'payment.read'],
  support_technician_no_pii: ['support.technical_status.read'],
  technical_admin_no_pii: ['support.technical_status.read', 'integrations.configure', 'import.configure'],
  break_glass_admin: ['break_glass.initiate'],
  platform_admin_no_pii: ['platform.tenants.manage', 'support.technical_status.read'],
  billing_admin_no_pii: ['billing.read'],
  implementation_consultant_no_pii: ['support.technical_status.read', 'readiness.manage'],
};

/** Modules a permission belongs to (for module entitlement gating). */
export const PERMISSION_MODULES: Partial<Record<PermissionKey, ModuleId>> = {
  'case.lss.read': 'lss',
  'case.lss.write': 'lss',
  'case.ea.read': 'economic_assistance',
  'case.ea.write': 'economic_assistance',
  'payment.reconcile': 'payment_control',
  'payment.recipient.change': 'payment_control',
  'ubm.request.register': 'ubm_readiness',
  'ubm.request.read': 'ubm_readiness',
  'ubm.proposal.create': 'ubm_readiness',
  'ubm.proposal.review': 'ubm_readiness',
  'ubm.export.approve': 'ubm_readiness',
  'ubm.export.send': 'ubm_readiness',
  'ubm.notification.handle': 'ubm_readiness',
  'archive.manage': 'archive',
  'archive.export': 'archive',
  'import.run': 'import_gateway',
  'import.configure': 'import_gateway',
  'document.read': 'document_vault',
  'document.download': 'document_vault',
  'document.redact': 'document_vault',
  'case.control.read': 'control_cases',
  'case.control.write': 'control_cases',
  'case.control.decide': 'control_cases',
};
