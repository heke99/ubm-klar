import { redirect } from 'next/navigation';
import { ALL_ROLES } from '@ubm-klar/shared-types';
import { getWebAuthConfig } from '../../lib/auth-config';
import { getSession } from '../../lib/session';

export const dynamic = 'force-dynamic';

const ERROR_MESSAGES: Record<string, string> = {
  sso_not_configured:
    'Inloggning med SSO är inte konfigurerad för den här miljön. Kontakta er systemadministratör.',
  state_mismatch: 'Inloggningen kunde inte slutföras (säkerhetskontroll). Försök igen.',
  login_failed: 'Inloggningen misslyckades. Försök igen eller kontakta er systemadministratör.',
  invalid_role: 'Ogiltig roll vald.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; loggedout?: string }>;
}) {
  const session = await getSession();
  if (session) redirect('/');

  const params = await searchParams;
  const config = getWebAuthConfig();
  const ssoConfigured = Boolean(config.issuer && config.clientId);
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <div style={{ maxWidth: 480, margin: '3rem auto', padding: 'var(--space-4)' }}>
      <h1>Logga in</h1>
      {params.loggedout ? (
        <p role="status" style={{ color: 'var(--color-success)' }}>
          Du är utloggad.
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {errorMessage}
        </p>
      ) : null}

      {ssoConfigured ? (
        <section
          style={{
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-3)',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Kommunens inloggning</h2>
          <p>Logga in med er organisations konto (Entra ID / SSO).</p>
          <a
            href="/auth/start"
            style={{
              display: 'inline-block',
              background: 'var(--color-primary)',
              color: 'var(--color-primary-contrast)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              textDecoration: 'none',
            }}
          >
            Logga in med SSO
          </a>
        </section>
      ) : (
        <p>
          SSO-inloggning är inte konfigurerad för den här miljön.
          {config.isProductionLike ? ' Kontakta er systemadministratör.' : ''}
        </p>
      )}

      {config.devLoginEnabled ? (
        <section
          style={{
            border: '1px dashed var(--color-warning)',
            borderRadius: 'var(--radius)',
            padding: 'var(--space-3)',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Demo-inloggning (endast test)</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
            Endast för lokal utveckling och demo. Fungerar aldrig i produktion.
          </p>
          <form method="post" action="/auth/dev-login">
            <label htmlFor="dev-role" style={{ display: 'block', marginBottom: 4 }}>
              Roll
            </label>
            <select
              id="dev-role"
              name="role"
              defaultValue="social_services_manager"
              style={{ width: '100%', padding: 'var(--space-2)', marginBottom: 'var(--space-2)' }}
            >
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <button
              type="submit"
              style={{
                background: 'var(--color-primary)',
                color: 'var(--color-primary-contrast)',
                border: 0,
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
              }}
            >
              Logga in som vald roll
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
