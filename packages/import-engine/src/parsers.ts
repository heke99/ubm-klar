/** Parsed tabular data, independent of source format. */
export interface ParsedTable {
  columns: string[];
  rows: Record<string, string>[];
  format: 'csv' | 'json' | 'xml' | 'excel';
  warnings: string[];
}

export class ImportParseError extends Error {
  constructor(
    message: string,
    public readonly rowNumber?: number,
  ) {
    super(message);
    this.name = 'ImportParseError';
  }
}

/** RFC 4180-style CSV parser with configurable delimiter (`,` or `;`). */
export function parseCsv(content: string, delimiter: ',' | ';' = ';'): ParsedTable {
  const warnings: string[] = [];
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    current.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (current.length > 1 || current[0] !== '') rows.push(current);
    current = [];
  };

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || current.length > 0) pushRow();

  if (rows.length === 0) {
    throw new ImportParseError('CSV file contains no rows');
  }
  const columns = rows[0]!.map((c) => c.trim());
  const dataRows = rows.slice(1).map((cells, index) => {
    if (cells.length !== columns.length) {
      warnings.push(`Row ${index + 2}: expected ${columns.length} columns, got ${cells.length}`);
    }
    const row: Record<string, string> = {};
    columns.forEach((col, colIndex) => {
      row[col] = (cells[colIndex] ?? '').trim();
    });
    return row;
  });
  return { columns, rows: dataRows, format: 'csv', warnings };
}

/** JSON array-of-objects parser. */
export function parseJsonArray(content: string): ParsedTable {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ImportParseError('Invalid JSON');
  }
  if (!Array.isArray(data)) {
    throw new ImportParseError('JSON import must be an array of objects');
  }
  const columns = new Set<string>();
  const rows = data.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ImportParseError('Each JSON row must be an object', index + 1);
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      columns.add(key);
      row[key] = value === null || value === undefined ? '' : String(value);
    }
    return row;
  });
  return { columns: [...columns], rows, format: 'json', warnings: [] };
}

/**
 * Minimal XML record parser for flat structures:
 * `<records><record><field>value</field>...</record></records>`.
 * Anything more complex should go through a format-specific integration template.
 */
export function parseFlatXml(content: string, recordElement = 'record'): ParsedTable {
  const recordPattern = new RegExp(`<${recordElement}[^>]*>([\\s\\S]*?)</${recordElement}>`, 'g');
  const fieldPattern = /<([A-Za-z_][\w.-]*)[^>]*>([\s\S]*?)<\/\1>/g;
  const columns = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const recordMatch of content.matchAll(recordPattern)) {
    const row: Record<string, string> = {};
    for (const fieldMatch of recordMatch[1]!.matchAll(fieldPattern)) {
      const key = fieldMatch[1]!;
      columns.add(key);
      row[key] = decodeXmlEntities(fieldMatch[2]!.trim());
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new ImportParseError(`No <${recordElement}> elements found in XML`);
  }
  return { columns: [...columns], rows, format: 'xml', warnings: [] };
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * Excel parsing abstraction. Real XLSX decoding is provided by an adapter in the
 * worker (kept out of this pure package); CSV-converted content flows through parseCsv.
 */
export interface ExcelAdapter {
  toCsv(content: Uint8Array, sheetName?: string): Promise<string>;
}

export async function parseExcel(
  content: Uint8Array,
  adapter: ExcelAdapter,
  sheetName?: string,
): Promise<ParsedTable> {
  const csv = await adapter.toCsv(content, sheetName);
  return { ...parseCsv(csv), format: 'excel' };
}
