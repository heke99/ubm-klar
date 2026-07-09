export const dynamic = 'force-dynamic';

export default function UnauthorizedPage() {
  return (
    <div style={{ maxWidth: 560, margin: '3rem auto', padding: 'var(--space-4)' }}>
      <h1>Behörighet saknas</h1>
      <p>
        Du är inloggad, men din roll ger inte tillgång till den här sidan eller åtgärden. All
        åtkomst styrs av behörighetsmodellen och kontrolleras alltid i backend — även om en länk
        visas kan servern neka åtgärden.
      </p>
      <p>
        Behöver du utökad behörighet? Kontakta kommunens systemägare eller administratör. Alla
        behörighetsändringar loggas.
      </p>
      <p>
        <a href="/">Till startsidan</a> · <a href="/logout">Logga ut</a>
      </p>
    </div>
  );
}
