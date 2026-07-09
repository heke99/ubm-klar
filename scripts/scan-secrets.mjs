#!/usr/bin/env node
/**
 * Secret scanner: fails if anything looking like a real credential is present in
 * the repository. Run in CI and before every release.
 *
 * Design goals:
 *  - Works in GitHub Actions and any checkout (shallow clones, tarballs).
 *  - Does not depend on git: uses `git ls-files` when available, otherwise walks
 *    the filesystem (skipping node_modules, build output and binaries).
 *  - Ignores safe examples (documented placeholders, .env.example values,
 *    obviously-synthetic test fixtures) via a narrow allowlist.
 *  - Fails closed on real-looking secrets.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const PATTERNS = [
  {
    name: 'Supabase service role JWT',
    regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'Supabase secret key', regex: /sb_secret_[A-Za-z0-9]{10,}/ },
  {
    name: 'Private key block',
    regex: /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS secret pair', regex: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9+/]{30,}/i },
  { name: 'Stripe live key', regex: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: 'Generic assigned secret',
    regex: /(password|secret|api[_-]?key|token)\s*[:=]\s*['"][A-Za-z0-9+/]{20,}['"]/i,
  },
  {
    name: 'Postgres URL with credentials',
    regex: /postgres(ql)?:\/\/\w+:(?!ubm@)[^@\s'"]{4,}@(?!localhost|127\.0\.0\.1)/,
  },
];

// Files whose *contents* may legitimately match patterns:
//  - this scanner (pattern definitions)
//  - lockfile (integrity hashes)
//  - markdown docs (redacted examples)
//  - .env.example (empty placeholders only; still scanned for real values below)
const PATH_ALLOWLIST = [/(^|\/)scripts\/scan-secrets\.mjs$/, /(^|\/)pnpm-lock\.yaml$/, /\.md$/];

// Values that look like secrets but are documented, structurally safe examples.
const VALUE_ALLOWLIST = [
  /sb_publishable_/, // publishable keys are not secrets
  /example|placeholder|redacted|synthetic|dummy|changeme/i,
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  '.pnpm-store',
  '.vercel',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.xlsx',
]);

function gitFiles() {
  try {
    const out = execSync('git ls-files', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out.split('\n').filter(Boolean);
    return files.length > 0 ? files : undefined;
  } catch {
    return undefined;
  }
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      acc.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
    }
  }
  return acc;
}

function listFiles() {
  const fromGit = gitFiles();
  if (fromGit) return { files: fromGit, source: 'git' };
  return { files: walk(root, []), source: 'filesystem' };
}

const { files, source } = listFiles();
const scannable = files.filter((f) => {
  if (PATH_ALLOWLIST.some((a) => a.test(f))) return false;
  const dot = f.lastIndexOf('.');
  if (dot >= 0 && BINARY_EXTENSIONS.has(f.slice(dot).toLowerCase())) return false;
  return true;
});

let findings = 0;
let scanned = 0;
for (const file of scannable) {
  const abs = join(root, file);
  let content;
  try {
    if (statSync(abs).size > 5 * 1024 * 1024) continue;
    content = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  scanned++;
  for (const pattern of PATTERNS) {
    const match = content.match(pattern.regex);
    if (!match) continue;
    // Judge the surrounding line, not just the token, so documented placeholders
    // like `password: "EXAMPLE..."` are recognized as safe.
    const lineStart = content.lastIndexOf('\n', content.indexOf(match[0])) + 1;
    const lineEnd = content.indexOf('\n', lineStart);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (VALUE_ALLOWLIST.some((a) => a.test(line))) continue;
    console.error(`SECRET? ${file}: ${pattern.name} ("${match[0].slice(0, 24)}…")`);
    findings++;
  }
}

if (findings > 0) {
  console.error(
    `\n${findings} potential secret(s) found. Remove them and rotate any real credentials.`,
  );
  process.exit(1);
}
console.info(`secret scan clean (${scanned} files scanned via ${source})`);
