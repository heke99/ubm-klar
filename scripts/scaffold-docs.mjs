// One-time scaffold for the docs tree. Existing files are never overwritten.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const sections = {
  architecture: 'Architecture decisions, deployment models, data plane isolation and diagrams.',
  security: 'Security principles, threat model, service-role handling, RLS strategy and hardening checklists.',
  gdpr: 'GDPR documentation: legal bases, purposes, records of processing, data subject rights.',
  dpia: 'Data protection impact assessment templates and completed assessments per module.',
  procurement: 'Procurement support: responsibility matrices, SLA/security/exit appendices.',
  deployment: 'Deployment guides for Model B (vendor-hosted isolated) and Model C (municipality-owned).',
  'incident-response': 'Incident response process, severity matrix, communication templates (no PII).',
  support: 'Support model without PII, JIT access process, support bundle policy.',
  accessibility: 'WCAG 2.1 AA / EN 301 549 documentation and accessibility statement templates.',
  archive: 'Archive and retention documentation: classifications, retention rules, disposal.',
  'e-archive': 'E-archive export package formats, manifests and checksum verification.',
  'user-manuals': 'Swedish end-user manuals per role and module.',
  onboarding: 'Municipal onboarding program: stages, readiness scores, go-live checklist.',
  'legal-sources': 'Legal source register: laws, ordinances and guidance with versioning.',
  'exit-plan': 'Exit plan: full data export, formats, verification and handover process.',
};

for (const [dir, description] of Object.entries(sections)) {
  const path = join(root, 'docs', dir);
  mkdirSync(path, { recursive: true });
  const readme = join(path, 'README.md');
  if (!existsSync(readme)) {
    const title = dir
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    writeFileSync(readme, `# ${title}\n\n${description}\n`);
  }
}
console.info('Docs skeleton created.');
