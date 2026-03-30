import type { PaktFormat } from '@sriinnu/pakt';

type ScalarValue = string | number | boolean | null;
type TableRecord = Record<string, ScalarValue>;

const WIDE_TABLE_COLUMN_THRESHOLD = 6;

export interface TableVariant {
  id: 'layout-csv' | 'layout-json' | 'layout-yaml';
  label: string;
  format: Extract<PaktFormat, 'csv' | 'json' | 'yaml'>;
  note: string;
  text: string;
}

export interface TableProfile {
  sourceFormat: 'csv' | 'json';
  rowCount: number;
  columnCount: number;
  wide: boolean;
  summary: string;
}

export interface TablePackPlan {
  profile: TableProfile;
  variants: readonly TableVariant[];
}

export function createTablePackPlan(input: string, format: PaktFormat): TablePackPlan | null {
  const dataset = getTableDataset(input, format);
  if (!dataset) {
    return null;
  }

  const profile: TableProfile = {
    sourceFormat: dataset.sourceFormat,
    rowCount: dataset.records.length,
    columnCount: dataset.fields.length,
    wide: dataset.fields.length >= WIDE_TABLE_COLUMN_THRESHOLD,
    summary:
      dataset.fields.length >= WIDE_TABLE_COLUMN_THRESHOLD
        ? `Wide table detected: ${dataset.records.length} rows x ${dataset.fields.length} columns.`
        : `Tabular payload detected: ${dataset.records.length} rows x ${dataset.fields.length} columns.`,
  };

  const variants: TableVariant[] =
    dataset.sourceFormat === 'json'
      ? [
          {
            id: 'layout-csv',
            label: 'CSV projection',
            format: 'csv',
            note: 'Normalize the array into header-plus-row CSV before packing. Often strongest on wide uniform records.',
            text: buildCsv(dataset.fields, dataset.records),
          },
          {
            id: 'layout-yaml',
            label: 'YAML list',
            format: 'yaml',
            note: 'Readable list layout. Useful when CSV quoting gets noisy or reviewers need a softer structure.',
            text: buildYaml(dataset.fields, dataset.records),
          },
        ]
      : [
          {
            id: 'layout-json',
            label: 'JSON array projection',
            format: 'json',
            note: 'Re-encode rows as repeated key-value objects. Can beat CSV when the schema is short and the table is sparse.',
            text: JSON.stringify(dataset.records, null, 2),
          },
          {
            id: 'layout-yaml',
            label: 'YAML list',
            format: 'yaml',
            note: 'Readable record list with repeated keys. Good fallback when you want structure without CSV quoting.',
            text: buildYaml(dataset.fields, dataset.records),
          },
        ];

  return { profile, variants };
}

interface TableDataset {
  sourceFormat: 'csv' | 'json';
  fields: string[];
  records: TableRecord[];
}

function getTableDataset(input: string, format: PaktFormat): TableDataset | null {
  if (format === 'csv') {
    return getCsvDataset(input);
  }

  if (format === 'json') {
    return getJsonDataset(input);
  }

  return null;
}

function getCsvDataset(input: string): TableDataset | null {
  const rows = parseCsv(input).filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length < 3) {
    return null;
  }

  const [header, ...dataRows] = rows;
  if (!header || header.length < 3) {
    return null;
  }

  const width = header.length;
  if (dataRows.some((row) => row.length !== width)) {
    return null;
  }

  const fields = header.map((field) => field.trim());
  if (fields.some((field) => field.length === 0)) {
    return null;
  }

  const records = dataRows.map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ''])),
  );

  return {
    sourceFormat: 'csv',
    fields,
    records,
  };
}

function getJsonDataset(input: string): TableDataset | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length < 2) {
    return null;
  }

  const first = parsed[0];
  if (!isPlainScalarRecord(first)) {
    return null;
  }

  const fields = Object.keys(first);
  if (fields.length < 3) {
    return null;
  }

  const records: TableRecord[] = [];
  for (const entry of parsed) {
    if (!isPlainScalarRecord(entry)) {
      return null;
    }

    const keys = Object.keys(entry);
    if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) {
      return null;
    }

    records.push(
      Object.fromEntries(fields.map((field) => [field, entry[field] ?? null])) as TableRecord,
    );
  }

  return {
    sourceFormat: 'json',
    fields,
    records,
  };
}

function isPlainScalarRecord(value: unknown): value is TableRecord {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every(isScalarValue);
}

function isScalarValue(value: unknown): value is ScalarValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function buildCsv(fields: readonly string[], records: readonly TableRecord[]): string {
  const lines = [fields.map(csvEscape).join(',')];

  for (const record of records) {
    lines.push(fields.map((field) => csvEscape(formatScalar(record[field] ?? null))).join(','));
  }

  return lines.join('\n');
}

function buildYaml(fields: readonly string[], records: readonly TableRecord[]): string {
  return records
    .map((record) =>
      fields
        .map((field, index) => {
          const prefix = index === 0 ? '- ' : '  ';
          return `${prefix}${field}: ${formatYamlScalar(record[field] ?? null)}`;
        })
        .join('\n'),
    )
    .join('\n');
}

function formatScalar(value: ScalarValue): string {
  if (value === null) {
    return '';
  }
  return String(value);
}

function formatYamlScalar(value: ScalarValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_.:/-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    const next = input[index + 1] ?? '';

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      field += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      if (next === '\n') {
        index += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
