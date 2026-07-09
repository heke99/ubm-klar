import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isLikelyPersonnummer } from '@ubm-klar/config';
import {
  applyMapping,
  createNodeExcelAdapter,
  detectFormat,
  getImportType,
  getSourceSystemAdapter,
  hashImportFile,
  IMPORT_TYPES,
  ImportParseError,
  parseCsv,
  parseExcel,
  parseJsonArray,
  SOURCE_SYSTEM_ADAPTERS,
  suggestMappings,
  validateRows,
  XlsxParseError,
  type FieldMapping,
  type MappedRow,
  type ParsedTable,
} from '@ubm-klar/import-engine';
import type { AuditLogger } from '@ubm-klar/audit';
import type { DataAccessLogger } from '@ubm-klar/data-access-log';
import { COMMITTERS, CommitError } from './import-commit';

/**
 * Import pipeline routes:
 * upload -> (detect+parse+stage) -> mapping -> preview -> validate -> commit
 * with rollback before commit and idempotency by file hash.
 */

export interface ImportRoutesOptions {
  auditLogger: AuditLogger;
  accessLogger: DataAccessLogger;
  requirePermission: (
    request: FastifyRequest,
    reply: FastifyReply,
    permission: 'import.run' | 'import.configure',
  ) => boolean;
  demoAllowed: (request: FastifyRequest) => boolean;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 50_000;

export function registerImportRoutes(app: FastifyInstance, options: ImportRoutesOptions): void {
  const { auditLogger, requirePermission } = options;

  app.get('/imports/source-systems', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run')) return;
    return { sourceSystems: SOURCE_SYSTEM_ADAPTERS };
  });

  app.get('/imports/types', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run')) return;
    return { importTypes: IMPORT_TYPES };
  });

  app.post<{
    Body: {
      fileName: string;
      contentBase64: string;
      importTypeKey: string;
      sourceSystemKey: string;
    };
  }>('/imports', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run')) return;
    if (!request.repositories) {
      return reply.status(503).send({ error: 'no_data_plane', message: 'Dataplan saknas.' });
    }
    const { fileName, contentBase64, importTypeKey, sourceSystemKey } = request.body;

    const importType = getImportType(importTypeKey);
    if (!importType) {
      return reply.status(400).send({ error: 'unknown_import_type', message: 'Okänd importtyp.' });
    }
    const adapter = getSourceSystemAdapter(sourceSystemKey);
    if (!adapter) {
      return reply.status(400).send({ error: 'unknown_source_system' });
    }
    if (!adapter.available) {
      return reply.status(422).send({
        error: 'source_system_unavailable',
        message: adapter.unavailableReason ?? 'Adaptern är inte tillgänglig.',
      });
    }

    const content = Buffer.from(contentBase64, 'base64');
    if (content.length === 0 || content.length > MAX_UPLOAD_BYTES) {
      return reply
        .status(413)
        .send({ error: 'file_too_large', message: 'Filen är tom eller för stor (max 25 MB).' });
    }

    const fileHash = hashImportFile(content);
    const existing = await request.repositories.importBatches.findByFileHash(fileHash);
    if (existing) {
      // Idempotency: the same file cannot be committed twice.
      return reply.status(409).send({
        error: 'duplicate_file',
        message: `Filen är redan importerad (batch ${existing.id}).`,
        batchId: existing.id,
      });
    }

    const format = detectFormat(fileName, content.subarray(0, 512).toString('utf8'));
    let table: ParsedTable;
    try {
      if (format === 'excel') {
        table = await parseExcel(content, createNodeExcelAdapter());
      } else if (format === 'json') {
        if (sourceSystemKey !== 'internal_json') {
          return reply.status(422).send({
            error: 'json_internal_only',
            message: 'JSON-import är endast tillåten för internt test-format.',
          });
        }
        table = parseJsonArray(content.toString('utf8'));
      } else if (format === 'csv') {
        const text = content.toString('utf8');
        const delimiter = (text.split('\n')[0] ?? '').includes(';') ? ';' : ',';
        table = parseCsv(text, delimiter);
      } else {
        return reply.status(422).send({
          error: 'unsupported_format',
          message: `Formatet kunde inte identifieras (${format}).`,
        });
      }
    } catch (error) {
      if (error instanceof ImportParseError || error instanceof XlsxParseError) {
        return reply.status(422).send({ error: 'parse_failed', message: error.message });
      }
      throw error;
    }
    if (table.rows.length > MAX_ROWS) {
      return reply
        .status(413)
        .send({ error: 'too_many_rows', message: `Max ${MAX_ROWS} rader per import.` });
    }

    const repos = request.repositories;
    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    const batch = await repos.importBatches.create({
      importKind: importType.batchKind,
      fileName,
      fileHashSha256: fileHash,
      rowCount: table.rows.length,
      importedBy: profileId,
    });

    await repos.db.withTransaction(async (tx) => {
      for (const [index, row] of table.rows.entries()) {
        await tx.query(
          `insert into import_staging_rows (batch_id, row_number, raw) values ($1::uuid, $2, $3::jsonb)`,
          [batch.id, index + 1, JSON.stringify(row)],
        );
      }
      await tx.query(
        `insert into import_mappings (batch_id, import_type_key, source_system_key, mapping, created_by)
         values ($1::uuid, $2, $3, '[]'::jsonb, $4::uuid)`,
        [batch.id, importTypeKey, sourceSystemKey, profileId],
      );
    });
    await repos.importBatches.updateStatus(batch.id, 'mapping');

    await auditLogger.record({
      eventKey: 'import.batch',
      actorUserId: request.subject!.userId,
      action: 'import_uploaded',
      context: {
        batchId: batch.id,
        importTypeKey,
        sourceSystemKey,
        rowCount: table.rows.length,
        correlationId: request.correlationId,
      },
    });

    const mappingSuggestions = suggestMappings(
      table.columns,
      importType.fields.map((f) => f.field),
    );
    return reply.status(201).send({
      batchId: batch.id,
      columns: table.columns,
      rowCount: table.rows.length,
      warnings: table.warnings,
      targetFields: importType.fields,
      mappingSuggestions,
    });
  });

  app.get<{ Params: { batchId: string } }>('/imports/:batchId', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const batch = await request.repositories.importBatches.getById(request.params.batchId);
    if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
    const errors = await request.repositories.importBatches.listErrors(batch.id);
    const mapping = await request.repositories.db.query<{
      import_type_key: string;
      source_system_key: string;
      mapping: FieldMapping[];
    }>(
      'select import_type_key, source_system_key, mapping from import_mappings where batch_id = $1::uuid',
      [batch.id],
    );
    return {
      batch,
      errors,
      importTypeKey: mapping.rows[0]?.import_type_key,
      sourceSystemKey: mapping.rows[0]?.source_system_key,
      mapping: mapping.rows[0]?.mapping ?? [],
    };
  });

  app.post<{ Params: { batchId: string }; Body: { mappings: FieldMapping[] } }>(
    '/imports/:batchId/mapping',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'import.run')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const batch = await repos.importBatches.getById(request.params.batchId);
      if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
      if (!['received', 'mapping', 'validating'].includes(batch.status)) {
        return reply
          .status(409)
          .send({ error: 'batch_not_mappable', message: `Batchen har status ${batch.status}.` });
      }
      const typeRow = await repos.db.query<{ import_type_key: string }>(
        'select import_type_key from import_mappings where batch_id = $1::uuid',
        [batch.id],
      );
      const importType = getImportType(typeRow.rows[0]?.import_type_key ?? '');
      if (!importType) return reply.status(500).send({ error: 'import_type_missing' });

      const validTargets = new Set(importType.fields.map((f) => f.field));
      for (const mapping of request.body.mappings) {
        if (!validTargets.has(mapping.targetField)) {
          return reply.status(400).send({
            error: 'invalid_target_field',
            message: `Okänt målfält "${mapping.targetField}" för importtypen.`,
          });
        }
      }

      const staged = await repos.db.query<{ row_number: number; raw: Record<string, string> }>(
        'select row_number, raw from import_staging_rows where batch_id = $1::uuid order by row_number',
        [batch.id],
      );
      const table: ParsedTable = {
        columns: Object.keys(staged.rows[0]?.raw ?? {}),
        rows: staged.rows.map((r) => r.raw),
        format: 'csv',
        warnings: [],
      };
      const template = {
        templateKey: 'adhoc',
        name: 'Ad hoc',
        importKind: importType.key,
        mappings: request.body.mappings,
      };
      const result = applyMapping(table, template);

      await repos.db.withTransaction(async (tx) => {
        await tx.query('update import_mappings set mapping = $2::jsonb where batch_id = $1::uuid', [
          batch.id,
          JSON.stringify(request.body.mappings),
        ]);
        for (const row of result.rows) {
          await tx.query(
            `update import_staging_rows set mapped = $3::jsonb, errors = $4
             where batch_id = $1::uuid and row_number = $2`,
            [batch.id, row.rowNumber, JSON.stringify(row.values), row.errors],
          );
        }
      });
      await repos.importBatches.updateStatus(batch.id, 'validating');
      return {
        batchId: batch.id,
        mappedRows: result.rows.length,
        mappingErrors: result.errorCount,
      };
    },
  );

  app.get<{ Params: { batchId: string }; Querystring: { limit?: string } }>(
    '/imports/:batchId/preview',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'import.run')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const batch = await repos.importBatches.getById(request.params.batchId);
      if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
      const limit = Math.min(Number(request.query.limit ?? 20), 100);
      const rows = await repos.db.query<{
        row_number: number;
        raw: Record<string, string>;
        mapped: Record<string, string> | null;
        errors: string[];
        warnings: string[];
      }>(
        `select row_number, raw, mapped, errors, warnings from import_staging_rows
         where batch_id = $1::uuid order by row_number limit $2`,
        [batch.id, limit],
      );
      // Import previews expose person data: always in the data access log.
      await repos.dataAccess.insert({
        actorUserId: await repos.users.ensureUserProfile(request.subject!.userId),
        accessKind: 'case_open',
        caseKind: 'import_batch',
        caseId: batch.id,
        reason: 'importgranskning',
        sessionKind: request.subject!.sessionKind,
      });
      return { batchId: batch.id, rows: rows.rows };
    },
  );

  app.post<{ Params: { batchId: string } }>(
    '/imports/:batchId/validate',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'import.run')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const batch = await repos.importBatches.getById(request.params.batchId);
      if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
      const typeRow = await repos.db.query<{ import_type_key: string }>(
        'select import_type_key from import_mappings where batch_id = $1::uuid',
        [batch.id],
      );
      const importType = getImportType(typeRow.rows[0]?.import_type_key ?? '');
      if (!importType) return reply.status(500).send({ error: 'import_type_missing' });

      const staged = await repos.db.query<{
        row_number: number;
        mapped: Record<string, string> | null;
        errors: string[];
      }>(
        'select row_number, mapped, errors from import_staging_rows where batch_id = $1::uuid order by row_number',
        [batch.id],
      );
      if (staged.rows.some((r) => r.mapped === null)) {
        return reply
          .status(409)
          .send({ error: 'mapping_required', message: 'Kolumnmappning måste göras först.' });
      }

      const mappedRows: MappedRow[] = staged.rows.map((r) => ({
        rowNumber: r.row_number,
        values: r.mapped!,
        errors: r.errors,
      }));
      const issues = validateRows(mappedRows, importType, {
        allowSyntheticPersonnummer: options.demoAllowed(request),
        isLikelyPersonnummer,
      });

      await repos.db.withTransaction(async (tx) => {
        await tx.query('delete from import_errors where batch_id = $1::uuid', [batch.id]);
        for (const issue of issues.filter((i) => i.severity === 'error')) {
          await tx.query(
            `insert into import_errors (batch_id, row_number, error_code, error_message)
           values ($1::uuid, $2, $3, $4)`,
            [batch.id, issue.rowNumber, issue.code, issue.message],
          );
        }
        const errorRows = new Map<number, string[]>();
        const warningRows = new Map<number, string[]>();
        for (const issue of issues) {
          const bucket = issue.severity === 'error' ? errorRows : warningRows;
          bucket.set(issue.rowNumber, [...(bucket.get(issue.rowNumber) ?? []), issue.message]);
        }
        for (const row of mappedRows) {
          await tx.query(
            `update import_staging_rows set errors = $3, warnings = $4
           where batch_id = $1::uuid and row_number = $2`,
            [
              batch.id,
              row.rowNumber,
              errorRows.get(row.rowNumber) ?? [],
              warningRows.get(row.rowNumber) ?? [],
            ],
          );
        }
      });

      const errorRowCount = new Set(
        issues.filter((i) => i.severity === 'error').map((i) => i.rowNumber),
      ).size;
      await auditLogger.record({
        eventKey: 'import.batch',
        actorUserId: request.subject!.userId,
        action: 'import_validated',
        context: {
          batchId: batch.id,
          totalRows: mappedRows.length,
          errorRows: errorRowCount,
          correlationId: request.correlationId,
        },
      });
      return {
        batchId: batch.id,
        totalRows: mappedRows.length,
        errorRows: errorRowCount,
        validRows: mappedRows.length - errorRowCount,
        issues: issues.slice(0, 500),
      };
    },
  );

  app.post<{ Params: { batchId: string } }>('/imports/:batchId/commit', async (request, reply) => {
    if (!requirePermission(request, reply, 'import.run')) return;
    if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
    const repos = request.repositories;
    const batch = await repos.importBatches.getById(request.params.batchId);
    if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
    if (['loaded', 'partially_loaded'].includes(batch.status)) {
      return reply
        .status(409)
        .send({ error: 'already_committed', message: 'Batchen är redan inläst.' });
    }
    if (batch.status === 'rejected') {
      return reply
        .status(409)
        .send({ error: 'batch_rejected', message: 'Batchen är avvisad/återställd.' });
    }
    const typeRow = await repos.db.query<{ import_type_key: string }>(
      'select import_type_key from import_mappings where batch_id = $1::uuid',
      [batch.id],
    );
    const importType = getImportType(typeRow.rows[0]?.import_type_key ?? '');
    if (!importType) return reply.status(500).send({ error: 'import_type_missing' });
    const committer = COMMITTERS[importType.key];
    if (!committer) {
      return reply.status(422).send({
        error: 'NOT_IMPLEMENTED',
        message: `Import av typen ${importType.key} är inte implementerad.`,
      });
    }

    const staged = await repos.db.query<{
      row_number: number;
      mapped: Record<string, string> | null;
      errors: string[];
    }>(
      'select row_number, mapped, errors from import_staging_rows where batch_id = $1::uuid order by row_number',
      [batch.id],
    );
    const validRows = staged.rows.filter((r) => r.mapped !== null && r.errors.length === 0);
    if (validRows.length === 0) {
      return reply.status(422).send({
        error: 'no_valid_rows',
        message: 'Inga giltiga rader att läsa in — validera först.',
      });
    }

    const profileId = await repos.users.ensureUserProfile(request.subject!.userId);
    let committedCount = 0;
    try {
      await repos.db.withTransaction(async (tx) => {
        for (const row of validRows) {
          const committed = await committer(
            { tx, batchId: batch.id, importedByProfileId: profileId },
            row.row_number,
            row.mapped!,
          );
          await tx.query(
            `update import_staging_rows set committed_entity_kind = $3, committed_entity_id = $4::uuid
             where batch_id = $1::uuid and row_number = $2`,
            [batch.id, committed.rowNumber, committed.entityKind, committed.entityId],
          );
          committedCount++;
        }
      });
    } catch (error) {
      if (error instanceof CommitError) {
        await repos.importBatches.addError({
          batchId: batch.id,
          rowNumber: error.rowNumber,
          errorCode: error.code,
          errorMessage: error.message,
        });
        await repos.importBatches.updateStatus(batch.id, 'failed', {
          errorSummary: error.message,
          finished: true,
        });
        return reply
          .status(422)
          .send({ error: error.code, message: error.message, rowNumber: error.rowNumber });
      }
      throw error;
    }

    const skippedRows = staged.rows.length - validRows.length;
    const finalStatus = skippedRows > 0 ? 'partially_loaded' : 'loaded';
    await repos.importBatches.updateStatus(batch.id, finalStatus, { finished: true });
    await auditLogger.record({
      eventKey: 'import.batch',
      actorUserId: request.subject!.userId,
      action: 'import_committed',
      context: {
        batchId: batch.id,
        committedRows: committedCount,
        skippedRows,
        importTypeKey: importType.key,
        correlationId: request.correlationId,
      },
    });
    return { batchId: batch.id, status: finalStatus, committedRows: committedCount, skippedRows };
  });

  app.post<{ Params: { batchId: string } }>(
    '/imports/:batchId/rollback',
    async (request, reply) => {
      if (!requirePermission(request, reply, 'import.run')) return;
      if (!request.repositories) return reply.status(503).send({ error: 'no_data_plane' });
      const repos = request.repositories;
      const batch = await repos.importBatches.getById(request.params.batchId);
      if (!batch) return reply.status(404).send({ error: 'batch_not_found' });
      if (['loaded', 'partially_loaded'].includes(batch.status)) {
        return reply.status(409).send({
          error: 'already_committed',
          message: 'Inlästa batcher kan inte rullas tillbaka — använd gallring/rättelse i stället.',
        });
      }
      await repos.db.query('delete from import_staging_rows where batch_id = $1::uuid', [batch.id]);
      await repos.importBatches.updateStatus(batch.id, 'rejected', {
        errorSummary: 'Återställd före inläsning',
        finished: true,
      });
      await auditLogger.record({
        eventKey: 'import.batch',
        actorUserId: request.subject!.userId,
        action: 'import_rolled_back',
        context: { batchId: batch.id, correlationId: request.correlationId },
      });
      return { batchId: batch.id, status: 'rejected' };
    },
  );
}
