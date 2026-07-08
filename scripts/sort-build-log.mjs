// Keeps docs/build-log.md sections ordered by batch number.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/build-log.md', import.meta.url).pathname;
const text = readFileSync(path, 'utf8');
const headerEnd = text.indexOf('## Batch');
const header = text.slice(0, headerEnd).trimEnd();
const body = text.slice(headerEnd);
const sections = body.split(/\n(?=## Batch )/).filter((s) => s.trim());
sections.sort((a, b) => {
  const numberOf = (s) => Number(s.match(/## Batch (\d+)/)?.[1] ?? 0);
  return numberOf(a) - numberOf(b);
});
writeFileSync(path, header + '\n\n' + sections.map((s) => s.trimEnd()).join('\n\n') + '\n');
console.info(`sorted ${sections.length} batch sections`);
