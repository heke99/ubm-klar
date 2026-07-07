#!/usr/bin/env node
/**
 * Secret scanner: fails if anything looking like a real credential is
 * committed. Run in CI and before every release.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Supabase service role JWT', regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Supabase secret key', regex: /sb_secret_[A-Za-z0-9]{10,}/ },
  { name: 'Private key block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Stripe live key', regex: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: 'Generic assigned secret', regex: /(password|secret|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/]{20,}['"]/i },
  { name: 'Postgres URL with credentials', regex: /postgres(ql)?:\/\/\w+:(?!ubm@)[^@\s'"]{4,}@(?!localhost)/ },
];

const ALLOWLIST = [/scan-secrets\.mjs$/, /pnpm-lock\.yaml$/, /\.md$/];

const files = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !ALLOWLIST.some((a) => a.test(f)));

let findings = 0;
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      console.error(`SECRET? ${file}: ${pattern.name} ("${match[0].slice(0, 24)}…")`);
      findings++;
    }
  }
}

if (findings > 0) {
  console.error(`\n${findings} potential secret(s) found. Remove them and rotate any real credentials.`);
  process.exit(1);
}
console.info(`secret scan clean (${files.length} files)`);
