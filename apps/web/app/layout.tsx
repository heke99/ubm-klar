import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  NON_AUTHORITY_DISCLAIMER_SV,
  PRODUCT_NAME,
  PRODUCT_TAGLINE_SV,
} from '@ubm-klar/shared-types';
import { DEMO_ROLES, navForRoles } from '../components/navigation';
import '../design-system/tokens.css';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} – kommunal UBM-beredskap`,
  description: PRODUCT_TAGLINE_SV,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const areas = navForRoles(DEMO_ROLES);
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
          }}
        >
          <strong style={{ fontSize: '1.2rem' }}>{PRODUCT_NAME}</strong>
          <span style={{ marginLeft: 'var(--space-3)', fontSize: '0.9rem', opacity: 0.9 }}>
            {PRODUCT_TAGLINE_SV}
          </span>
        </header>
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 120px)' }}>
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
                    style={{ display: 'block', padding: 'var(--space-2)', textDecoration: 'none', borderRadius: 'var(--radius)' }}
                  >
                    {area.labelSv}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
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
          </p>
        </footer>
      </body>
    </html>
  );
}
