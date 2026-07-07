'use client';

import { ErrorState } from '../design-system/components';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <ErrorState message="Sidan kunde inte visas. Försök igen eller kontakta er systemförvaltare om felet kvarstår." />
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-primary)',
          color: 'var(--color-primary-contrast)',
          cursor: 'pointer',
        }}
      >
        Försök igen
      </button>
    </div>
  );
}
