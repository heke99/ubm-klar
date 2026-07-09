import { redirect } from 'next/navigation';
import { Card, StatusBadge } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface BatchResponse {
  batch: {
    id: string;
    importKind: string;
    fileName: string | undefined;
    rowCount: number | undefined;
    status: string;
    errorSummary: string | undefined;
  };
  errors: Array<{ rowNumber: number | undefined; errorCode: string; errorMessage: string }>;
  importTypeKey: string | undefined;
  mapping: Array<{ sourceColumn: string; targetField: string }>;
}

interface PreviewResponse {
  rows: Array<{
    row_number: number;
    raw: Record<string, string>;
    mapped: Record<string, string> | null;
    errors: string[];
    warnings: string[];
  }>;
}

interface TypesResponse {
  importTypes: Array<{
    key: string;
    labelSv: string;
    fields: Array<{ field: string; labelSv: string; required: boolean }>;
  }>;
}

async function mappingAction(formData: FormData) {
  'use server';
  const batchId = String(formData.get('batchId'));
  const fieldCount = Number(formData.get('fieldCount'));
  const mappings = [] as Array<{
    sourceColumn: string;
    targetField: string;
    required: boolean;
    transform?: string;
  }>;
  for (let i = 0; i < fieldCount; i++) {
    const targetField = String(formData.get(`target_${i}`) ?? '');
    const sourceColumn = String(formData.get(`source_${i}`) ?? '');
    const required = formData.get(`required_${i}`) === 'true';
    if (targetField && sourceColumn) {
      const transform =
        targetField === 'personnummer'
          ? 'personnummer_normalize'
          : targetField.includes('amount') || targetField.includes('cost')
            ? 'amount_sek'
            : targetField.includes('date') ||
                targetField.includes('_at') ||
                targetField.includes('valid_')
              ? 'date_iso'
              : undefined;
      mappings.push({ sourceColumn, targetField, required, ...(transform ? { transform } : {}) });
    }
  }
  await apiSend('POST', `/imports/${batchId}/mapping`, { mappings });
  redirect(`/importer/${batchId}`);
}

async function validateAction(formData: FormData) {
  'use server';
  const batchId = String(formData.get('batchId'));
  await apiSend('POST', `/imports/${batchId}/validate`);
  redirect(`/importer/${batchId}`);
}

async function commitAction(formData: FormData) {
  'use server';
  const batchId = String(formData.get('batchId'));
  await apiSend('POST', `/imports/${batchId}/commit`);
  redirect(`/importer/${batchId}`);
}

async function rollbackAction(formData: FormData) {
  'use server';
  const batchId = String(formData.get('batchId'));
  await apiSend('POST', `/imports/${batchId}/rollback`);
  redirect(`/importer/${batchId}`);
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Mottagen',
  parsing: 'Tolkas',
  validating: 'Validering krävs',
  mapping: 'Mappning krävs',
  loaded: 'Inläst',
  failed: 'Misslyckad',
  partially_loaded: 'Delvis inläst',
  rejected: 'Avvisad/återställd',
};

export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireSession();
  const { batchId } = await params;
  const [batchResult, previewResult, typesResult] = await Promise.all([
    apiGet<BatchResponse>(`/imports/${batchId}`),
    apiGet<PreviewResponse>(`/imports/${batchId}/preview?limit=10`),
    apiGet<TypesResponse>('/imports/types'),
  ]);

  if (batchResult.kind !== 'ok') {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <h1>Importbatch</h1>
        <ApiStateGuard result={batchResult} />
      </div>
    );
  }

  const { batch, errors, importTypeKey, mapping } = batchResult.data;
  const importType =
    typesResult.kind === 'ok'
      ? typesResult.data.importTypes.find((t) => t.key === importTypeKey)
      : undefined;
  const previewRows = previewResult.kind === 'ok' ? previewResult.data.rows : [];
  const columns = Object.keys(previewRows[0]?.raw ?? {});
  const committed = ['loaded', 'partially_loaded'].includes(batch.status);
  const rejected = batch.status === 'rejected' || batch.status === 'failed';

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Import: {batch.fileName ?? batch.id.slice(0, 8)}</h1>
      <p>
        Status:{' '}
        <StatusBadge
          status={STATUS_LABELS[batch.status] ?? batch.status}
          tone={committed ? 'success' : rejected ? 'danger' : 'info'}
        />{' '}
        · {batch.rowCount ?? '?'} rader · Typ: {importType?.labelSv ?? importTypeKey}
      </p>
      {batch.errorSummary ? (
        <p style={{ color: 'var(--color-danger)' }}>{batch.errorSummary}</p>
      ) : null}

      {!committed && !rejected && importType ? (
        <Card title="1. Kolumnmappning">
          <form action={mappingAction}>
            <input type="hidden" name="batchId" value={batch.id} />
            <input type="hidden" name="fieldCount" value={importType.fields.length} />
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: 'var(--space-2)' }}>Målfält</th>
                  <th style={{ padding: 'var(--space-2)' }}>Källkolumn</th>
                </tr>
              </thead>
              <tbody>
                {importType.fields.map((field, i) => {
                  const current = mapping.find((m) => m.targetField === field.field);
                  return (
                    <tr key={field.field}>
                      <td style={{ padding: 'var(--space-2)' }}>
                        {field.labelSv}
                        {field.required ? ' *' : ''}
                        <input type="hidden" name={`target_${i}`} value={field.field} />
                        <input
                          type="hidden"
                          name={`required_${i}`}
                          value={String(field.required)}
                        />
                      </td>
                      <td style={{ padding: 'var(--space-2)' }}>
                        <select name={`source_${i}`} defaultValue={current?.sourceColumn ?? ''}>
                          <option value="">— ej mappad —</option>
                          {columns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button type="submit" style={{ marginTop: 8 }}>
              Spara mappning
            </button>
          </form>
        </Card>
      ) : null}

      <Card title="2. Förhandsgranskning (första raderna)">
        {previewRows.length === 0 ? (
          <p>Inga rader att visa{rejected ? ' — batchen är återställd.' : '.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>#</th>
                  {columns.map((column) => (
                    <th key={column} style={{ padding: '4px 8px' }}>
                      {column}
                    </th>
                  ))}
                  <th style={{ padding: '4px 8px' }}>Fel/varningar</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr
                    key={row.row_number}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      background: row.errors.length > 0 ? '#fde8e6' : undefined,
                    }}
                  >
                    <td style={{ padding: '4px 8px' }}>{row.row_number}</td>
                    {columns.map((column) => (
                      <td key={column} style={{ padding: '4px 8px' }}>
                        {row.raw[column]}
                      </td>
                    ))}
                    <td style={{ padding: '4px 8px', color: 'var(--color-danger)' }}>
                      {[...row.errors, ...row.warnings].join('; ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {errors.length > 0 ? (
        <Card title={`Valideringsfel (${errors.length})`}>
          <ul>
            {errors.slice(0, 50).map((error, i) => (
              <li key={i}>
                Rad {error.rowNumber ?? '?'}: [{error.errorCode}] {error.errorMessage}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!committed && !rejected ? (
        <Card title="3. Validera och läs in">
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <form action={validateAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <button type="submit">Validera</button>
            </form>
            <form action={commitAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <button
                type="submit"
                style={{
                  background: 'var(--color-primary)',
                  color: 'var(--color-primary-contrast)',
                  border: 0,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius)',
                }}
              >
                Läs in giltiga rader
              </button>
            </form>
            <form action={rollbackAction}>
              <input type="hidden" name="batchId" value={batch.id} />
              <button type="submit" style={{ color: 'var(--color-danger)' }}>
                Avbryt och återställ
              </button>
            </form>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Inläsning tar endast med rader utan fel. Batchen kan återställas fram till inläsning;
            därefter gäller rättelse/gallring enligt arkivreglerna.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
