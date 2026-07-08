import { EmptyState } from '../design-system/components';

export default function NotFound() {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <h1>Sidan finns inte</h1>
      <EmptyState
        message="Sidan du försökte nå finns inte eller har flyttats."
        action="Gå tillbaka till Översikt via menyn."
      />
    </div>
  );
}
