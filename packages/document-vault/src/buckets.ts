/** Per-municipality storage buckets. Each municipality has its OWN storage. */
export type BucketKey =
  | 'documents-lss'
  | 'documents-economic-assistance'
  | 'documents-ubm'
  | 'documents-redacted'
  | 'ubm-exports'
  | 'support-bundles-no-pii'
  | 'archive-exports'
  | 'public-record-disclosures'
  | 'exit-exports';

export interface BucketPolicy {
  bucketKey: BucketKey;
  containsPii: boolean;
  /** Roles allowed to read objects (mirrored in storage policies). */
  readRoles: string[];
  writeRoles: string[];
  /** Export from this bucket always requires an approval record. */
  exportRequiresApproval: boolean;
  allowedMimeTypes: string[];
  maxFileSizeBytes: number;
}

const DOC_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Text documents: needed for the pilot's automatic redaction flow.
  'text/plain',
];

const MB = 1024 * 1024;

export const BUCKET_POLICIES: Record<BucketKey, BucketPolicy> = {
  'documents-lss': {
    bucketKey: 'documents-lss',
    containsPii: true,
    readRoles: ['lss_case_worker', 'social_services_manager', 'control_investigator', 'lawyer'],
    writeRoles: ['lss_case_worker'],
    exportRequiresApproval: true,
    allowedMimeTypes: DOC_MIME_TYPES,
    maxFileSizeBytes: 50 * MB,
  },
  'documents-economic-assistance': {
    bucketKey: 'documents-economic-assistance',
    containsPii: true,
    readRoles: [
      'economic_assistance_case_worker',
      'social_services_manager',
      'control_investigator',
      'lawyer',
    ],
    writeRoles: ['economic_assistance_case_worker'],
    exportRequiresApproval: true,
    allowedMimeTypes: DOC_MIME_TYPES,
    maxFileSizeBytes: 50 * MB,
  },
  'documents-ubm': {
    bucketKey: 'documents-ubm',
    containsPii: true,
    readRoles: ['ubm_export_manager', 'lawyer', 'dpo'],
    writeRoles: ['ubm_export_manager'],
    exportRequiresApproval: true,
    allowedMimeTypes: DOC_MIME_TYPES,
    maxFileSizeBytes: 50 * MB,
  },
  'documents-redacted': {
    bucketKey: 'documents-redacted',
    containsPii: true,
    readRoles: ['ubm_export_manager', 'lawyer', 'dpo', 'control_investigator'],
    writeRoles: ['ubm_export_manager', 'lawyer'],
    exportRequiresApproval: true,
    allowedMimeTypes: ['application/pdf', 'text/plain'],
    maxFileSizeBytes: 50 * MB,
  },
  'ubm-exports': {
    bucketKey: 'ubm-exports',
    containsPii: true,
    readRoles: ['ubm_export_manager'],
    writeRoles: ['ubm_export_manager'],
    exportRequiresApproval: true,
    allowedMimeTypes: ['application/json', 'application/zip', 'application/xml'],
    maxFileSizeBytes: 200 * MB,
  },
  'support-bundles-no-pii': {
    bucketKey: 'support-bundles-no-pii',
    containsPii: false,
    readRoles: ['support_technician_no_pii', 'technical_admin_no_pii'],
    writeRoles: ['technical_admin_no_pii'],
    exportRequiresApproval: false,
    allowedMimeTypes: ['application/json', 'application/zip', 'text/plain'],
    maxFileSizeBytes: 100 * MB,
  },
  'archive-exports': {
    bucketKey: 'archive-exports',
    containsPii: true,
    readRoles: ['municipality_admin'],
    writeRoles: ['municipality_admin'],
    exportRequiresApproval: true,
    allowedMimeTypes: ['application/zip', 'application/xml'],
    maxFileSizeBytes: 2000 * MB,
  },
  'public-record-disclosures': {
    bucketKey: 'public-record-disclosures',
    containsPii: true,
    readRoles: ['lawyer'],
    writeRoles: ['lawyer'],
    exportRequiresApproval: true,
    allowedMimeTypes: ['application/pdf', 'application/zip'],
    maxFileSizeBytes: 500 * MB,
  },
  'exit-exports': {
    bucketKey: 'exit-exports',
    containsPii: true,
    readRoles: ['municipality_admin', 'system_owner'],
    writeRoles: ['system_owner'],
    exportRequiresApproval: true,
    allowedMimeTypes: ['application/zip'],
    maxFileSizeBytes: 10_000 * MB,
  },
};
