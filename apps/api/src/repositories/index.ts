import type { DbClient } from '@ubm-klar/db';
import { AuditRepository } from './audit-repository';
import { ControlCaseRepository } from './control-case-repository';
import { DataAccessRepository } from './data-access-repository';
import { DocumentRepository } from './document-repository';
import { EconomicAssistanceRepository } from './ea-repository';
import { ImportBatchRepository } from './import-batch-repository';
import { LssRepository } from './lss-repository';
import { NotificationRepository } from './notification-repository';
import { PaymentControlRepository } from './payment-control-repository';
import { ReadinessRepository } from './readiness-repository';
import { UbmRequestRepository } from './ubm-request-repository';
import { ExportProposalRepository } from './export-proposal-repository';
import { UsersRepository } from './users-repository';

export * from './audit-repository';
export * from './control-case-repository';
export * from './data-access-repository';
export * from './document-repository';
export * from './ea-repository';
export * from './import-batch-repository';
export * from './lss-repository';
export * from './notification-repository';
export * from './payment-control-repository';
export * from './readiness-repository';
export * from './ubm-request-repository';
export * from './export-proposal-repository';
export * from './users-repository';

export interface Repositories {
  users: UsersRepository;
  lss: LssRepository;
  ea: EconomicAssistanceRepository;
  ubmRequests: UbmRequestRepository;
  exportProposals: ExportProposalRepository;
  importBatches: ImportBatchRepository;
  documents: DocumentRepository;
  audit: AuditRepository;
  dataAccess: DataAccessRepository;
  readiness: ReadinessRepository;
  controlCases: ControlCaseRepository;
  paymentControl: PaymentControlRepository;
  notifications: NotificationRepository;
}

export function createRepositories(db: DbClient): Repositories {
  return {
    users: new UsersRepository(db),
    lss: new LssRepository(db),
    ea: new EconomicAssistanceRepository(db),
    ubmRequests: new UbmRequestRepository(db),
    exportProposals: new ExportProposalRepository(db),
    importBatches: new ImportBatchRepository(db),
    documents: new DocumentRepository(db),
    audit: new AuditRepository(db),
    dataAccess: new DataAccessRepository(db),
    readiness: new ReadinessRepository(db),
    controlCases: new ControlCaseRepository(db),
    paymentControl: new PaymentControlRepository(db),
    notifications: new NotificationRepository(db),
  };
}
