// One-time scaffold for workspace package boilerplate (package.json + tsconfig.json).
// Source files are authored manually. Safe to re-run: existing files are not overwritten.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

/** @type {Record<string, string[]>} package name -> extra workspace deps */
const packages = {
  'shared-types': [],
  config: ['shared-types'],
  'tenant-resolver': ['shared-types'],
  'supabase-client': ['shared-types', 'tenant-resolver'],
  'access-control': ['shared-types'],
  'internal-secrecy': ['shared-types', 'access-control'],
  audit: ['shared-types'],
  'data-access-log': ['shared-types', 'audit'],
  'data-classification': ['shared-types'],
  'information-classification': ['shared-types', 'data-classification'],
  'import-engine': ['shared-types'],
  'data-quality-engine': ['shared-types'],
  'rule-engine': ['shared-types', 'evidence-chain'],
  'payment-control-engine': ['shared-types', 'rule-engine'],
  'reconciliation-engine': ['shared-types'],
  'document-vault': ['shared-types', 'data-classification'],
  'redaction-engine': ['shared-types'],
  'archive-engine': ['shared-types'],
  'public-record-engine': ['shared-types'],
  'approval-workflows': ['shared-types'],
  'data-lineage': ['shared-types'],
  'evidence-chain': ['shared-types'],
  'anomaly-detection': ['shared-types'],
  'legal-source-engine': ['shared-types'],
  'ubm-schema-engine': ['shared-types', 'legal-source-engine'],
  'ubm-obligation-engine': ['shared-types', 'legal-source-engine'],
  'ubm-eligibility-engine': ['shared-types'],
  'ubm-export-engine': ['shared-types', 'evidence-chain', 'approval-workflows'],
  'lss-domain': ['shared-types', 'rule-engine'],
  'economic-assistance-domain': ['shared-types', 'rule-engine'],
  'onboarding-engine': ['shared-types'],
  'billing-engine': ['shared-types'],
};

for (const [name, deps] of Object.entries(packages)) {
  const dir = join(root, 'packages', name);
  mkdirSync(join(dir, 'src'), { recursive: true });

  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    const dependencies = Object.fromEntries(deps.map((d) => [`@ubm-klar/${d}`, 'workspace:*']));
    writeFileSync(
      pkgPath,
      JSON.stringify(
        {
          name: `@ubm-klar/${name}`,
          version: '1.0.0',
          private: true,
          type: 'module',
          main: 'src/index.ts',
          types: 'src/index.ts',
          exports: { '.': './src/index.ts' },
          scripts: {
            build: 'tsc -p tsconfig.json --noEmit',
            typecheck: 'tsc -p tsconfig.json --noEmit',
            test: 'vitest run --passWithNoTests',
          },
          dependencies,
          devDependencies: { vitest: '^2.1.8' },
        },
        null,
        2,
      ) + '\n',
    );
  }

  const tsconfigPath = join(dir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    writeFileSync(
      tsconfigPath,
      JSON.stringify({ extends: '../../tsconfig.base.json', include: ['src'] }, null, 2) + '\n',
    );
  }

  const indexPath = join(dir, 'src', 'index.ts');
  if (!existsSync(indexPath)) {
    writeFileSync(indexPath, `export const PACKAGE_NAME = '@ubm-klar/${name}';\n`);
  }
}

console.info(`Scaffolded ${Object.keys(packages).length} packages.`);
