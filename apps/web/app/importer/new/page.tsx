import { redirect } from 'next/navigation';
import { Card } from '../../../design-system/components';
import { apiGet, apiSend } from '../../../lib/api';
import { requireSession } from '../../../lib/require-session';
import { ApiStateGuard } from '../../../components/page-states';

export const dynamic = 'force-dynamic';

interface TypesResponse {
  importTypes: Array<{ key: string; labelSv: string }>;
}
interface SystemsResponse {
  sourceSystems: Array<{
    key: string;
    name: string;
    available: boolean;
    unavailableReason?: string;
  }>;
}

async function uploadAction(formData: FormData) {
  'use server';
  const file = formData.get('file') as File | null;
  const importTypeKey = String(formData.get('importTypeKey') ?? '');
  const sourceSystemKey = String(formData.get('sourceSystemKey') ?? '');
  if (!file || file.size === 0) redirect('/importer/new?error=missing_file');

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await apiSend<{ batchId: string }>('POST', '/imports', {
    fileName: file.name,
    contentBase64: buffer.toString('base64'),
    importTypeKey,
    sourceSystemKey,
  });
  if (result.kind !== 'ok') {
    redirect(
      `/importer/new?error=${result.kind === 'error' ? `status_${result.status ?? 'unknown'}` : result.kind}`,
    );
  }
  redirect(`/importer/${result.data.batchId}`);
}

const ERRORS: Record<string, string> = {
  missing_file: 'Välj en fil att importera.',
  forbidden: 'Din roll saknar behörighet att importera.',
  status_409: 'Filen är redan importerad (samma innehåll finns i en tidigare batch).',
  status_422: 'Filen kunde inte tolkas eller källsystemet är inte tillgängligt.',
  status_413: 'Filen är för stor (max 25 MB).',
};

export default async function NyImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireSession();
  const params = await searchParams;
  const [types, systems] = await Promise.all([
    apiGet<TypesResponse>('/imports/types'),
    apiGet<SystemsResponse>('/imports/source-systems'),
  ]);

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 640 }}>
      <h1>Starta ny import</h1>
      {params.error ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {ERRORS[params.error] ?? 'Importen kunde inte startas. Försök igen.'}
        </p>
      ) : null}
      <ApiStateGuard result={types} />
      {types.kind === 'ok' && systems.kind === 'ok' ? (
        <Card title="Ladda upp fil (CSV eller XLSX)">
          <form action={uploadAction}>
            <label htmlFor="import-file" style={{ display: 'block', marginBottom: 4 }}>
              Fil
            </label>
            <input id="import-file" type="file" name="file" accept=".csv,.xlsx,.txt" required />

            <label htmlFor="import-type" style={{ display: 'block', margin: '12px 0 4px' }}>
              Importtyp
            </label>
            <select id="import-type" name="importTypeKey" style={{ width: '100%', padding: 8 }}>
              {types.data.importTypes.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.labelSv}
                </option>
              ))}
            </select>

            <label htmlFor="source-system" style={{ display: 'block', margin: '12px 0 4px' }}>
              Källsystem
            </label>
            <select id="source-system" name="sourceSystemKey" style={{ width: '100%', padding: 8 }}>
              {systems.data.sourceSystems.map((system) => (
                <option key={system.key} value={system.key} disabled={!system.available}>
                  {system.name}
                  {system.available ? '' : ' — ej tillgängligt'}
                </option>
              ))}
            </select>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Systemspecifika adaptrar som inte är implementerade är avstängda — använd generisk
              CSV/XLSX-export från källsystemet.
            </p>

            <button
              type="submit"
              style={{
                marginTop: 12,
                background: 'var(--color-primary)',
                color: 'var(--color-primary-contrast)',
                border: 0,
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              Ladda upp och fortsätt till mappning
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
