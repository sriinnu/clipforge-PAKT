import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress } from '../../packages/pakt-core/dist/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const fixturesDir = join(repoRoot, 'packages', 'pakt-core', 'benchmarks', 'fixtures');
const outputPath = join(repoRoot, 'docs', 'BENCHMARK-SNAPSHOT.md');
const packageJsonPath = join(repoRoot, 'packages', 'pakt-core', 'package.json');
const L4_BUDGET_RATIO = 0.7;
const MIN_L4_BUDGET = 12;
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

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
  const lossless = compress(input, getOptions(fixture.file));
  const l3 = compress(input, {
    ...getOptions(fixture.file),
    layers: { tokenizerAware: true },
  });
  const l4Budget = Math.max(MIN_L4_BUDGET, Math.floor(lossless.compressedTokens * L4_BUDGET_RATIO));
  const l4 = compress(input, {
    ...getOptions(fixture.file),
    layers: { tokenizerAware: true, semantic: true },
    semanticBudget: l4Budget,
  });

  return {
    ...fixture,
    compressedTokens: lossless.compressedTokens,
    dictionaryEntries: lossless.dictionary.length,
    dictionarySavings: lossless.savings.byLayer.dictionary,
    l3Delta: lossless.compressedTokens - l3.compressedTokens,
    l3Tokens: l3.compressedTokens,
    l4Budget,
    l4Delta: lossless.compressedTokens - l4.compressedTokens,
    l4IsLossy: !l4.reversible,
    l4Tokens: l4.compressedTokens,
    originalTokens: lossless.originalTokens,
    savingsPercent: lossless.savings.totalPercent,
    structuralSavings: lossless.savings.byLayer.structural,
  };
});

const positiveRows = rows.filter((row) => row.savingsPercent > 0);
const l4Rows = rows.filter((row) => row.l4IsLossy);
const best = rows.reduce((winner, row) =>
  row.savingsPercent > winner.savingsPercent ? row : winner,
);
const worst = rows.reduce((loser, row) =>
  row.savingsPercent < loser.savingsPercent ? row : loser,
);
const bestL3 = rows.reduce((winner, row) => (row.l3Delta > winner.l3Delta ? row : winner));
const bestL4 = rows.reduce((winner, row) => (row.l4Delta > winner.l4Delta ? row : winner));

const lines = [
  '# Benchmark Snapshot',
  '',
  `Release-facing fixture snapshot for \`@sriinnu/pakt@${version}\`.`,
  '',
  '## Method',
  '',
  '- Generated with `scripts/release/generate-benchmark-snapshot.mjs`',
  '- Token counting uses the package default model path (`gpt-4o` via `gpt-tokenizer`)',
  '- Release-facing baseline is the default lossless path: `L1 + L2`',
  `- Tradeoff section also measures lossless \`L1 + L2 + L3\` and lossy \`L1 + L2 + L3 + L4\` with per-fixture budgets set to ${Math.round(L4_BUDGET_RATIO * 100)}% of the lossless \`L1 + L2\` token count`,
  '- Fixtures come from `packages/pakt-core/benchmarks/fixtures/`',
  '',
  '## Default Lossless Snapshot',
  '',
  '| Fixture | Original | Compressed | Savings | L1 | L2 | Dict | Note |',
  '|---|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(
    (row) =>
      `| ${row.label} | ${row.originalTokens} | ${row.compressedTokens} | ${fmtSigned(row.savingsPercent)}% | ${row.structuralSavings} | ${row.dictionarySavings} | ${row.dictionaryEntries} | ${row.note} |`,
  ),
  '',
  '## L3 / L4 Tradeoff Snapshot',
  '',
  '| Fixture | L1+L2 | L1+L2+L3 | L3 Δ | L1+L2+L3+L4 | L4 Budget | L4 Δ |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...rows.map(
    (row) =>
      `| ${row.label} | ${row.compressedTokens} | ${row.l3Tokens} | ${fmtSigned(row.l3Delta)} | ${row.l4Tokens} | ${row.l4Budget} | ${fmtSigned(row.l4Delta)} |`,
  ),
  '',
  '## Readout',
  '',
  `- Best fixture: **${best.label}** at **${best.savingsPercent}%** token savings`,
  `- Weakest fixture: **${worst.label}** at **${worst.savingsPercent}%** token savings`,
  `- Positive-savings fixtures: **${positiveRows.length}/${rows.length}**`,
  `- Best L3 uplift: **${bestL3.label}** at **${bestL3.l3Delta}** additional tokens saved beyond the default lossless path`,
  `- Best budgeted L4 uplift: **${bestL4.label}** at **${bestL4.l4Delta}** additional tokens saved beyond the default lossless path`,
  `- L4 triggered lossy output on **${l4Rows.length}/${rows.length}** fixtures in this snapshot`,
  '- L4 deltas reflect budget-fitting lossy output; large jumps mean information was discarded to hit the target budget, not that the lossless format suddenly became better.',
  '- Honest takeaway: PAKT is strongest on JSON-like structured payloads with repeated keys, tabular rows, or repeated values. It is not a blanket improvement for already-compact CSV.',
  '',
  '## Public Claim Guardrails',
  '',
  '- Safe lossless claim: **typical 30-50% savings on structured payloads across the core L1-L3 pipeline**',
  '- Clarify that higher gains mainly show up on tabular and repetitive JSON',
  '- Treat L4 numbers as opt-in, budgeted, and lossy; do not mix them into lossless marketing copy',
  '- Do not frame PAKT as a general prose compressor',
  '- Mention that the browser extension is experimental',
  '',
];

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${outputPath}`);
