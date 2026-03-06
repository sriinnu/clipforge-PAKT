import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress } from '../../packages/pakt-core/dist/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const fixturesDir = join(repoRoot, 'packages', 'pakt-core', 'benchmarks', 'fixtures');
const outputPath = join(repoRoot, 'docs', 'BENCHMARK-SNAPSHOT.md');

const FIXTURES = [
  {
    file: 'small-objects.json',
    label: 'Small object array',
    note: 'Uniform JSON rows compress well via tabular L1 encoding.',
  },
  {
    file: 'tabular-50.json',
    label: 'Tabular JSON (50 rows)',
    note: 'Best-fit PAKT shape: repeated keys plus repeated values.',
  },
  {
    file: 'nested-config.json',
    label: 'Nested config JSON',
    note: 'Moderate gains from structural simplification, limited L2 help.',
  },
  {
    file: 'api-response.json',
    label: 'API response JSON',
    note: 'Less regular than tabular data, so savings are lower.',
  },
  {
    file: 'wide-object.json',
    label: 'Wide object JSON',
    note: 'Single-object payloads save some syntax but little repetition.',
  },
  {
    file: 'mixed-types.yaml',
    label: 'Mixed YAML config',
    note: 'YAML already removes some JSON syntax overhead, so gains are smaller.',
  },
  {
    file: 'large-table.csv',
    label: 'Large CSV table',
    note: 'CSV is already compact; PAKT is not a universal win here.',
  },
];

function getOptions(file) {
  if (file.endsWith('.yaml')) return { fromFormat: 'yaml' };
  if (file.endsWith('.csv')) return { fromFormat: 'csv' };
  return undefined;
}

function fmtSigned(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

const rows = FIXTURES.map((fixture) => {
  const input = readFileSync(join(fixturesDir, fixture.file), 'utf8');
  const result = compress(input, getOptions(fixture.file));
  return {
    ...fixture,
    compressedTokens: result.compressedTokens,
    dictionaryEntries: result.dictionary.length,
    dictionarySavings: result.savings.byLayer.dictionary,
    originalTokens: result.originalTokens,
    savingsPercent: result.savings.totalPercent,
    structuralSavings: result.savings.byLayer.structural,
  };
});

const positiveRows = rows.filter((row) => row.savingsPercent > 0);
const best = rows.reduce((winner, row) =>
  row.savingsPercent > winner.savingsPercent ? row : winner,
);
const worst = rows.reduce((loser, row) =>
  row.savingsPercent < loser.savingsPercent ? row : loser,
);

const lines = [
  '# Benchmark Snapshot',
  '',
  'Release-facing fixture snapshot for `@sriinnu/pakt@0.4.2`.',
  '',
  '## Method',
  '',
  '- Generated with `scripts/release/generate-benchmark-snapshot.mjs`',
  '- Token counting uses the package default model path (`gpt-4o` via `gpt-tokenizer`)',
  '- Compression mode is the default lossless path: `L1 + L2`',
  '- Fixtures come from `packages/pakt-core/benchmarks/fixtures/`',
  '',
  '## Snapshot',
  '',
  '| Fixture | Original | Compressed | Savings | L1 | L2 | Dict | Note |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(
    (row) =>
      `| ${row.label} | ${row.originalTokens} | ${row.compressedTokens} | ${fmtSigned(row.savingsPercent)}% | ${row.structuralSavings} | ${row.dictionarySavings} | ${row.dictionaryEntries} | ${row.note} |`,
  ),
  '',
  '## Readout',
  '',
  `- Best fixture: **${best.label}** at **${best.savingsPercent}%** token savings`,
  `- Weakest fixture: **${worst.label}** at **${worst.savingsPercent}%** token savings`,
  `- Positive-savings fixtures: **${positiveRows.length}/${rows.length}**`,
  '- Honest takeaway: PAKT is strongest on JSON-like structured payloads with repeated keys, tabular rows, or repeated values. It is not a blanket improvement for already-compact CSV.',
  '',
  '## Public Claim Guardrails',
  '',
  '- Safe claim: **typical 30-50% savings on structured payloads**',
  '- Clarify that higher gains mainly show up on tabular and repetitive JSON',
  '- Do not frame PAKT as a general prose compressor',
  '- Mention that the browser extension is experimental',
  '',
];

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
