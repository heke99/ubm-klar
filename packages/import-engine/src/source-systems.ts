/**
 * Source system adapter registry.
 *
 * Named municipal system integrations are declared here but marked unavailable
 * until a real adapter is implemented and verified — the platform never claims
 * an integration is complete when it is not. Generic CSV/XLSX imports work for
 * every system that can export tabular data.
 */

export interface SourceSystemAdapter {
  key: string;
  name: string;
  available: boolean;
  /** Why the adapter is unavailable (shown in UI). */
  unavailableReason?: string;
  formats: Array<'csv' | 'excel' | 'json' | 'xml'>;
}

export const SOURCE_SYSTEM_ADAPTERS: readonly SourceSystemAdapter[] = [
  {
    key: 'generic_csv',
    name: 'Generisk CSV-export',
    available: true,
    formats: ['csv'],
  },
  {
    key: 'generic_xlsx',
    name: 'Generisk Excel-export (XLSX)',
    available: true,
    formats: ['excel'],
  },
  {
    key: 'internal_json',
    name: 'Internt JSON-format (endast test)',
    available: true,
    formats: ['json'],
  },
  {
    key: 'procapita_lifecare',
    name: 'Procapita/Lifecare (Tietoevry)',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
  {
    key: 'treserva',
    name: 'Treserva (CGI)',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
  {
    key: 'combine',
    name: 'Combine (Ilab)',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
  {
    key: 'pulsen',
    name: 'Pulsen Combine/Magna Cura',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
  {
    key: 'cgi',
    name: 'CGI (övriga system)',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
  {
    key: 'tietoevry',
    name: 'Tietoevry (övriga system)',
    available: false,
    unavailableReason:
      'Systemspecifik adapter ej implementerad — använd generisk CSV/XLSX-export tills vidare.',
    formats: ['csv', 'excel'],
  },
] as const;

export function getSourceSystemAdapter(key: string): SourceSystemAdapter | undefined {
  return SOURCE_SYSTEM_ADAPTERS.find((a) => a.key === key);
}
