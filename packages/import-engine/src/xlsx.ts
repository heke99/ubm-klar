import { inflateRawSync } from 'node:zlib';
import type { ExcelAdapter } from './parsers';

/**
 * Minimal XLSX reader (server-side, no dependencies): unpacks the OOXML zip
 * container, reads sharedStrings + the first worksheet and converts to CSV for
 * the shared CSV pipeline. Supports inline strings, shared strings, numbers
 * and dates-as-numbers are passed through as their raw values.
 *
 * Intentionally strict: encrypted, corrupt or exotic workbooks fail with a
 * clear error instead of being silently misread.
 */

export class XlsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxParseError';
  }
}

interface ZipEntry {
  fileName: string;
  data: Buffer;
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  // Locate End of Central Directory (EOCD).
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new XlsxParseError('Not a valid XLSX file (missing zip directory)');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new XlsxParseError('Corrupt XLSX central directory');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    // Local header: name/extra lengths may differ from the central directory.
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (compressionMethod === 0) {
      data = Buffer.from(compressed);
    } else if (compressionMethod === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new XlsxParseError(`Unsupported zip compression method ${compressionMethod}`);
    }
    entries.set(fileName, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#10;', '\n')
    .replaceAll('&amp;', '&');
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!));
    strings.push(parts.join(''));
  }
  return strings;
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function csvEscape(value: string): string {
  if (/[";\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function xlsxToCsv(content: Uint8Array, sheetName?: string): string {
  const entries = readZipEntries(Buffer.from(content));
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));

  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (sheetName) {
    const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
    const sheetMatch = workbook.match(
      new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="rId(\\d+)"`),
    );
    if (sheetMatch) sheetPath = `xl/worksheets/sheet${sheetMatch[1]}.xml`;
  }
  const sheetXml = entries.get(sheetPath)?.toString('utf8');
  if (!sheetXml) throw new XlsxParseError(`Worksheet not found: ${sheetPath}`);

  const csvRows: string[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(/<c(?:\s+([^>]*?))?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? '';
      const inner = cellMatch[2] ?? '';
      const ref = attributes.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attributes.match(/t="(\w+)"/)?.[1];
      const index = ref ? columnIndex(ref) : cells.length;

      let value = '';
      if (type === 's') {
        const stringIndex = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '-1');
        value = sharedStrings[stringIndex] ?? '';
      } else if (type === 'inlineStr') {
        value = decodeXml(inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '');
      } else {
        value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    csvRows.push(cells.map(csvEscape).join(';'));
  }
  if (csvRows.length === 0) throw new XlsxParseError('Worksheet contains no rows');
  return csvRows.join('\n');
}

/** Node ExcelAdapter for the shared import pipeline. */
export function createNodeExcelAdapter(): ExcelAdapter {
  return {
    toCsv: async (content, sheetName) => xlsxToCsv(content, sheetName),
  };
}

/** Builds a minimal, valid XLSX workbook from rows — used by tests and report export. */
export function buildXlsx(rows: string[][]): Buffer {
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">` +
        row
          .map((cell, colIndex) => {
            const ref = `${columnLetters(colIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
          })
          .join('') +
        '</row>',
    )
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Blad1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  return buildZip([
    { fileName: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { fileName: '_rels/.rels', data: Buffer.from(rootRels) },
    { fileName: 'xl/workbook.xml', data: Buffer.from(workbook) },
    { fileName: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels) },
    { fileName: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
}

function columnLetters(index: number): string {
  let letters = '';
  let n = index + 1;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.fileName, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // stored (no compression)
    local.writeUInt32LE(0, 10); // dos time/date
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, entry.data);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(0, 12);
    dir.writeUInt32LE(checksum, 16);
    dir.writeUInt32LE(entry.data.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0, 38); // external attrs
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + entry.data.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, eocd]);
}
