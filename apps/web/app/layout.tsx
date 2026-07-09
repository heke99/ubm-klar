import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  NON_AUTHORITY_DISCLAIMER_SV,
  PRODUCT_NAME,
  PRODUCT_TAGLINE_SV,
  type RoleId,
} from '@ubm-klar/shared-types';
import { navForRoles } from '../components/navigation';
import { fetchTenantInfo } from '../lib/api';
import { getSession } from '../lib/session';
import '../design-system/tokens.css';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} – kommunal UBM-beredskap`,
  description: PRODUCT_TAGLINE_SV,
};

export const dynamic = 'force-dynamic';

function EnvironmentBadge({ environment }: { environment: string }) {
  const label =
    environment === 'prod'
      ? 'Produktion'
      : environment === 'stage'
        ? 'Stage'
        : environment === 'demo'
          ? 'Demo'
          : environment === 'test'
            ? 'Test'
            : 'Lokal';
  return (
    <span
      style={{
        marginLeft: 'var(--space-3)',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: '0.75rem',
        background: environment === 'prod' ? 'var(--color-success)' : 'var(--color-warning)',
        color: '#1a1a1a',
      }}
    >
      {label}
    </span>
  );
}

function PilotBanner() {
  return (
    <div
      role="status"
      style={{
        background: 'var(--color-warning)',
        color: '#1a1a1a',
        padding: 'var(--space-2) var(--space-4)',
        fontSize: '0.85rem',
      }}
    >
      <strong>Kundpilotläge.</strong> Officiell UBM-överföring är avstängd — endast manuell export.
      Importera inte fullständiga produktionsdata innan PUB-avtal, DPIA och beredskapsgrindar är
      godkända. <a href="/pilot">Läs om pilotens begränsningar</a>.
    </div>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const tenant = session ? await fetchTenantInfo() : undefined;
  const areas = session ? navForRoles(session.subject.roles as RoleId[]) : [];
  const isPilot = tenant?.tenantStatus === 'pilot' || tenant?.environment === 'demo';

  return (
    <html lang="sv">
      <body>
        <a href="#huvudinnehall" className="skip-link">
          Hoppa till huvudinnehållet
        </a>
        <header
          style={{
            background: 'var(--color-primary)',
            color: 'var(--color-primary-contrast)',
            padding: 'var(--space-3) var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
          }}
        >
          <strong style={{ fontSize: '1.2rem' }}>{PRODUCT_NAME}</strong>
          {tenant?.municipality ? (
            <span style={{ fontSize: '0.95rem', opacity: 0.95 }}>— {tenant.municipality}</span>
          ) : (
            <span style={{ fontSize: '0.9rem', opacity: 0.9 }}>{PRODUCT_TAGLINE_SV}</span>
          )}
          {tenant?.environment ? <EnvironmentBadge environment={tenant.environment} /> : null}
          <span style={{ flex: 1 }} />
          {session ? (
            <span style={{ fontSize: '0.9rem', display: 'flex', gap: 'var(--space-3)' }}>
              <span aria-label="Inloggad användare">
                {session.displayName ?? session.subject.userId}
              </span>
              <a href="/stod" style={{ color: 'inherit' }}>
                Support
              </a>
              <a href="/logout" style={{ color: 'inherit' }}>
                Logga ut
              </a>
            </span>
          ) : null}
        </header>
        {session && isPilot ? <PilotBanner /> : null}
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 120px)' }}>
          {session ? (
            <nav
              aria-label="Huvudnavigation"
              style={{
                width: 230,
                padding: 'var(--space-3)',
                borderRight: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
              }}
            >
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {areas.map((area) => (
                  <li key={area.href} style={{ marginBottom: 'var(--space-1)' }}>
                    <a
                      href={area.href}
                      style={{
                        display: 'block',
                        padding: 'var(--space-2)',
                        textDecoration: 'none',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      {area.labelSv}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <main id="huvudinnehall" style={{ flex: 1 }}>
            {children}
          </main>
        </div>
        <footer
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
          }}
        >
          <p style={{ margin: 0 }}>{NON_AUTHORITY_DISCLAIMER_SV}</p>
          <p style={{ margin: '4px 0 0' }}>
            <a href="/tillganglighet">Tillgänglighetsredogörelse</a>
            {' · '}
            <a href="/juridik">Juridik och dataskydd</a>
            {' · '}
            <a href="/stod">Support och kontakt</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
