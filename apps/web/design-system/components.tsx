import type { ReactNode } from 'react';

/** Accessible building blocks: every page has loading/empty/error/denied states. */

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{title}</h2>
      {children}
    </section>
  );
}

export function StatGrid({
  stats,
}: {
  stats: Array<{
    label: string;
    value: string | number;
    tone?: 'default' | 'success' | 'warning' | 'danger';
  }>;
}) {
  const toneColor = {
    default: 'var(--color-text)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-danger)',
  } as const;
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--space-3)',
        margin: 0,
      }}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-3)',
          }}
        >
          <dt style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{stat.label}</dt>
          <dd
            style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: 700,
              color: toneColor[stat.tone ?? 'default'],
            }}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBadge({
  status,
  tone,
}: {
  status: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}) {
  const colors = {
    success: { bg: '#e6f4ea', fg: 'var(--color-success)' },
    warning: { bg: '#fdf3d7', fg: 'var(--color-warning)' },
    danger: { bg: '#fde8e6', fg: 'var(--color-danger)' },
    info: { bg: '#e5efff', fg: 'var(--color-info)' },
  } as const;
  const { bg, fg } = colors[tone];
  return (
    <span
      style={{
        background: bg,
        color: fg,
        borderRadius: '999px',
        padding: '2px 10px',
        fontSize: '0.8rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {status}
    </span>
  );
}

export function EmptyState({ message, action }: { message: string; action?: string }) {
  return (
    <div
      role="status"
      style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}
    >
      <p style={{ margin: 0 }}>{message}</p>
      {action ? <p style={{ marginTop: 'var(--space-2)' }}>{action}</p> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-3)',
        border: '1px solid var(--color-danger)',
        borderRadius: 'var(--radius)',
        background: '#fde8e6',
        color: 'var(--color-danger)',
      }}
    >
      <strong>Ett fel inträffade.</strong> {message}
    </div>
  );
}

export function LoadingState({ label = 'Laddar innehåll …' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)' }}
    >
      {label}
    </div>
  );
}

export function PermissionDenied({ requiredRole }: { requiredRole?: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-4)',
        border: '1px solid var(--color-warning)',
        borderRadius: 'var(--radius)',
        background: '#fdf3d7',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Behörighet saknas</h2>
      <p>
        Du har inte behörighet att se den här sidan.
        {requiredRole ? ` Sidan kräver rollen ${requiredRole}.` : ''} Kontakta er
        systemadministratör om du behöver åtkomst i tjänsten.
      </p>
    </div>
  );
}

export function BlockedExplanation({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) return null;
  return (
    <div
      role="alert"
      style={{
        padding: 'var(--space-3)',
        border: '1px solid var(--color-warning)',
        borderRadius: 'var(--radius)',
        background: '#fdf3d7',
        marginBottom: 'var(--space-3)',
      }}
    >
      <h3 style={{ marginTop: 0 }}>Varför är detta blockerat?</h3>
      <ul style={{ marginBottom: 0 }}>
        {blockers.map((blocker) => (
          <li key={blocker}>{blocker}</li>
        ))}
      </ul>
    </div>
  );
}

export function MaskedValue({ maskedValue }: { maskedValue: string }) {
  return (
    <span aria-label="Maskerad känslig uppgift. Kräver skäl för att visas.">
      {maskedValue}{' '}
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        (maskerad – ange skäl för att visa)
      </span>
    </span>
  );
}
