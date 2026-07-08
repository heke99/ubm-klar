// Regenerates the synthetic demo dataset (JSON seed files under supabase/seed/).
// Demo data is for demo/test environments ONLY and contains no real PII:
// all personnummer are structurally invalid (month >= 90) and marked synthetic.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const seedDir = join(root, 'supabase', 'seed');
mkdirSync(seedDir, { recursive: true });

// Run the generators through the workspace TS packages via a small vitest-free entry.
const script = `
import { generateLssDemoData } from '@ubm-klar/lss-domain';
import { generateEaDemoData } from '@ubm-klar/economic-assistance-domain';

const lss = generateLssDemoData();
const ea = generateEaDemoData();
console.log(JSON.stringify({ lssCounts: lss.counts, eaCounts: ea.counts }));
process.stdout.write('___SPLIT___');
process.stdout.write(JSON.stringify({ lss, ea }));
`;

const tmp = join(root, 'scripts', '.demo-reset-entry.mts');
writeFileSync(tmp, script);
try {
  const output = execSync(`npx tsx ${tmp}`, { cwd: root, maxBuffer: 512 * 1024 * 1024 }).toString();
  const [countsJson, dataJson] = output.split('___SPLIT___');
  const data = JSON.parse(dataJson);
  writeFileSync(join(seedDir, 'demo-lss.json'), JSON.stringify(data.lss, null, 1));
  writeFileSync(join(seedDir, 'demo-economic-assistance.json'), JSON.stringify(data.ea, null, 1));
  console.info('Demo seed regenerated:', countsJson.trim());
} finally {
  execSync(`rm -f ${tmp}`);
}
