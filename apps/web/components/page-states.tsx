import { EmptyState, ErrorState, PermissionDenied } from '../design-system/components';
import type { ApiResult } from '../lib/api';

/**
 * Maps API results to the shared design-system states. Returns null for OK
 * results (the caller renders the data). Combined with loading.tsx and
 * requireSession(), every data page gets loading/empty/error/forbidden states.
 */
export function ApiStateGuard<T>({ result }: { result: ApiResult<T> }) {
  if (result.kind === 'forbidden') return <PermissionDenied />;
  if (result.kind === 'unauthenticated')
    return <ErrorState message="Din session har gått ut. Logga in igen." />;
  if (result.kind === 'unknown_tenant')
    return <ErrorState message="Domänen kunde inte knytas till en kommun." />;
  if (result.kind === 'error')
    return <ErrorState message="Uppgifterna kunde inte hämtas. Försök igen om en stund." />;
  return null;
}

export function DemoDataWarning() {
  return (
    <div
      role="status"
      style={{
        border: '1px solid var(--color-warning)',
        background: '#fdf3d7',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-2) var(--space-3)',
        marginBottom: 'var(--space-3)',
        fontSize: '0.9rem',
      }}
    >
      <strong>Syntetisk demodata.</strong> Uppgifterna nedan är påhittade och avser ingen verklig
      person. Demodata kan aldrig visas i produktionsmiljö.
    </div>
  );
}

export function NoDataYet({ what }: { what: string }) {
  return (
    <EmptyState
      message={`Det finns ${what} att visa ännu.`}
      action="När kommunens data har importerats visas verkliga uppgifter här — aldrig påhittad statistik."
    />
  );
}

export {
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
} from '../design-system/components';
