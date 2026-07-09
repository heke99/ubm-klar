import { describe, expect, it } from 'vitest';
import { buildValidationReport, detectFormat, hashImportFile } from './batch';
import { applyMapping, applyTransform, suggestMappings } from './mapping';
import { parseCsv, parseFlatXml, parseJsonArray, ImportParseError } from './parsers';

describe('parseCsv', () => {
  it('parses semicolon-delimited CSV with header', () => {
    const table = parseCsv('id;namn;belopp\n1;Test;100,50\n2;Demo;200');
    expect(table.columns).toEqual(['id', 'namn', 'belopp']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual({ id: '1', namn: 'Test', belopp: '100,50' });
  });

  it('handles quoted fields with embedded delimiters and quotes', () => {
    const table = parseCsv('id;text\n1;"hej;värld ""citat"""');
    expect(table.rows[0]!.text).toBe('hej;värld "citat"');
  });

  it('warns on ragged rows', () => {
    const table = parseCsv('a;b\n1;2\n3');
    expect(table.warnings).toHaveLength(1);
  });

  it('throws on empty input', () => {
    expect(() => parseCsv('')).toThrow(ImportParseError);
  });
});

describe('parseJsonArray', () => {
  it('parses arrays of objects', () => {
    const table = parseJsonArray('[{"id":1,"name":"x"},{"id":2,"other":true}]');
    expect(table.columns).toContain('other');
    expect(table.rows[0]!.id).toBe('1');
  });

  it('rejects non-array JSON', () => {
    expect(() => parseJsonArray('{"a":1}')).toThrow(ImportParseError);
  });
});

describe('parseFlatXml', () => {
  it('parses flat record XML', () => {
    const xml = '<records><record><id>1</id><name>A &amp; B</name></record></records>';
    const table = parseFlatXml(xml);
    expect(table.rows[0]).toEqual({ id: '1', name: 'A & B' });
  });

  it('throws when no records found', () => {
    expect(() => parseFlatXml('<data></data>')).toThrow(ImportParseError);
  });
});

describe('transforms and mapping', () => {
  it('normalizes dates and amounts', () => {
    expect(applyTransform('2026/1/5', 'date_iso')).toBe('2026-01-05');
    expect(applyTransform('1 234,50 kr', 'amount_sek')).toBe('1234.50');
  });

  it('applies mapping with required-field validation', () => {
    const table = parseCsv('personnr;belopp\n19811218-9876;100\n;200');
    const result = applyMapping(table, {
      templateKey: 't1',
      name: 'test',
      importKind: 'payments',
      mappings: [
        { sourceColumn: 'personnr', targetField: 'personalIdentityNumber', required: true },
        { sourceColumn: 'belopp', targetField: 'amount', transform: 'amount_sek', required: true },
      ],
    });
    expect(result.errorCount).toBe(1);
    expect(result.rows[1]!.errors[0]).toContain('personalIdentityNumber');
  });

  it('suggests mapping candidates by name similarity', () => {
    const suggestions = suggestMappings(['Personnummer', 'Belopp SEK'], ['personnummer', 'belopp']);
    expect(suggestions[0]).toMatchObject({ sourceColumn: 'Personnummer', confidence: 1 });
  });
});

describe('batch helpers', () => {
  it('hashes file content deterministically', () => {
    expect(hashImportFile('abc')).toBe(hashImportFile('abc'));
    expect(hashImportFile('abc')).not.toBe(hashImportFile('abd'));
  });

  it('detects formats', () => {
    expect(detectFormat('data.xlsx', '')).toBe('excel');
    expect(detectFormat('data.csv', 'a;b')).toBe('csv');
    expect(detectFormat('payload.bin', '[{"a":1}]')).toBe('json');
    expect(detectFormat('payload.bin', '<records>')).toBe('xml');
  });

  it('builds validation reports with correct statuses', () => {
    const allOk = buildValidationReport('b1', 10, [], 0);
    expect(allOk.status).toBe('loaded');
    const partial = buildValidationReport(
      'b1',
      10,
      [{ batchId: 'b1', rowNumber: 3, errorCode: 'E', errorMessage: 'x' }],
      0,
    );
    expect(partial.status).toBe('partially_loaded');
    const allBad = buildValidationReport(
      'b1',
      1,
      [{ batchId: 'b1', rowNumber: 1, errorCode: 'E', errorMessage: 'x' }],
      0,
    );
    expect(allBad.status).toBe('rejected');
  });
});
