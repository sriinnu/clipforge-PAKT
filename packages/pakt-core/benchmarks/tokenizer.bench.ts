import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from 'gpt-tokenizer';
import { encode as encodeO200k } from 'gpt-tokenizer/model/gpt-4o';
/**
 * L3 Tokenizer-Aware Compression — benchmark gate.
 *
 * Measures whether swapping delimiters, boolean representations,
 * whitespace styles, or number formats in PAKT output yields
 * meaningful token savings across the cl100k_base (GPT-4) and
 * o200k_base (GPT-4o) tokenizers.
 *
 * VERDICT: PASS if average savings >= 3%, FAIL otherwise.
 */
import { bench, describe } from 'vitest';
import { compress } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

/** Load a fixture file from the fixtures directory. */
function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

// ---------------------------------------------------------------------------
// Fixture definitions: [label, raw content, compress options]
// ---------------------------------------------------------------------------

interface FixtureDef {
  /** Human-readable name for reporting. */
  label: string;
  /** Raw file content. */
  raw: string;
  /** Options passed to compress(). */
  opts?: Parameters<typeof compress>[1];
}

const FIXTURES: FixtureDef[] = [
  { label: 'small-objects.json', raw: loadFixture('small-objects.json') },
  { label: 'tabular-50.json', raw: loadFixture('tabular-50.json') },
  { label: 'nested-config.json', raw: loadFixture('nested-config.json') },
  { label: 'api-response.json', raw: loadFixture('api-response.json') },
  { label: 'wide-object.json', raw: loadFixture('wide-object.json') },
  { label: 'mixed-types.yaml', raw: loadFixture('mixed-types.yaml'), opts: { fromFormat: 'yaml' } },
  { label: 'large-table.csv', raw: loadFixture('large-table.csv'), opts: { fromFormat: 'csv' } },
];

// ---------------------------------------------------------------------------
// Variant generators — each takes PAKT output and produces an alternative
// ---------------------------------------------------------------------------

/**
 * Replace pipe delimiters in tabular rows with the given character.
 * Skips header annotations like {field1|field2} and dictionary lines.
 */
function swapDelimiter(pakt: string, from: string, to: string): string {
  return pakt
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      // Skip headers, dict blocks, comments, annotations
      if (trimmed.startsWith('@') || trimmed.startsWith('%')) return line;
      if (trimmed === '') return line;
      // Skip field-header lines (contain {…}:)
      if (/\{[^}]*\}:/.test(trimmed)) return line;
      // Only swap in data rows (indented, containing the delimiter)
      if (line.startsWith('  ') && trimmed.includes(from)) {
        return line.replaceAll(from, to);
      }
      return line;
    })
    .join('\n');
}

/**
 * Replace `true`/`false` literals with shorter boolean representations.
 * Only replaces standalone tokens (word-boundary match).
 */
function swapBooleans(pakt: string, trueVal: string, falseVal: string): string {
  return pakt.replace(/\btrue\b/g, trueVal).replace(/\bfalse\b/g, falseVal);
}

/**
 * Replace 2-space indentation with the given indent string.
 * Preserves the indentation depth (number of levels).
 */
function swapIndent(pakt: string, newIndent: string): string {
  return pakt
    .split('\n')
    .map((line) => {
      let depth = 0;
      let i = 0;
      while (i + 1 < line.length && line[i] === ' ' && line[i + 1] === ' ') {
        depth++;
        i += 2;
      }
      if (depth === 0) return line;
      return newIndent.repeat(depth) + line.slice(depth * 2);
    })
    .join('\n');
}

/**
 * Strip trailing zeros from numeric values in the PAKT output.
 * Converts e.g. "49.90" -> "49.9", "100.00" -> "100".
 */
function stripTrailingZeros(pakt: string): string {
  return pakt.replace(/\b(\d+\.\d*?)0+\b/g, (_match, core: string) => {
    return core.endsWith('.') ? core.slice(0, -1) : core;
  });
}

// ---------------------------------------------------------------------------
// Token counting helpers
// ---------------------------------------------------------------------------

/** Count tokens with cl100k_base (GPT-4). */
function countCl100k(text: string): number {
  return encode(text).length;
}

/** Count tokens with o200k_base (GPT-4o). */
function countO200k(text: string): number {
  return encodeO200k(text).length;
}

// ---------------------------------------------------------------------------
// Variant definitions
// ---------------------------------------------------------------------------

interface Variant {
  /** Short label for reporting. */
  label: string;
  /** Function that transforms PAKT output into this variant. */
  transform: (pakt: string) => string;
}

/** Delimiter alternatives. Baseline is `|` (pipe). */
const DELIMITER_VARIANTS: Variant[] = [
  { label: 'pipe (|) [baseline]', transform: (s) => s },
  { label: 'tab (\\t)', transform: (s) => swapDelimiter(s, '|', '\t') },
  { label: 'comma (,)', transform: (s) => swapDelimiter(s, '|', ',') },
  { label: 'semicolon (;)', transform: (s) => swapDelimiter(s, '|', ';') },
];

/** Boolean alternatives. Baseline is true/false. */
const BOOLEAN_VARIANTS: Variant[] = [
  { label: 'true/false [baseline]', transform: (s) => s },
  { label: 'T/F', transform: (s) => swapBooleans(s, 'T', 'F') },
  { label: '1/0', transform: (s) => swapBooleans(s, '1', '0') },
];

/** Whitespace/indentation alternatives. Baseline is 2-space. */
const INDENT_VARIANTS: Variant[] = [
  { label: '2-space [baseline]', transform: (s) => s },
  { label: '1-space', transform: (s) => swapIndent(s, ' ') },
  { label: 'tab', transform: (s) => swapIndent(s, '\t') },
];

/** Number format alternatives. Baseline is as-is. */
const NUMBER_VARIANTS: Variant[] = [
  { label: 'as-is [baseline]', transform: (s) => s },
  { label: 'strip trailing zeros', transform: (s) => stripTrailingZeros(s) },
];

// ---------------------------------------------------------------------------
// Run the analysis and print a report
// ---------------------------------------------------------------------------

interface CategoryResult {
  /** Category name (e.g. "Delimiters"). */
  category: string;
  /** Per-variant averages across all fixtures, both tokenizers. */
  variants: Array<{
    label: string;
    avgCl100k: number;
    avgO200k: number;
    pctDiffCl100k: number;
    pctDiffO200k: number;
  }>;
  /** Best savings % averaged across both tokenizers. */
  bestSavingsPct: number;
}

/**
 * Evaluate one category of variants across all fixtures and both tokenizers.
 * Returns structured results for the report.
 */
function evaluateCategory(
  categoryName: string,
  variants: Variant[],
  paktTexts: string[],
): CategoryResult {
  const baselineIdx = 0;
  const variantResults: CategoryResult['variants'] = [];

  for (const variant of variants) {
    let totalCl100k = 0;
    let totalO200k = 0;

    for (const pakt of paktTexts) {
      const transformed = variant.transform(pakt);
      totalCl100k += countCl100k(transformed);
      totalO200k += countO200k(transformed);
    }

    const avgCl100k = totalCl100k / paktTexts.length;
    const avgO200k = totalO200k / paktTexts.length;
    variantResults.push({
      label: variant.label,
      avgCl100k,
      avgO200k,
      pctDiffCl100k: 0,
      pctDiffO200k: 0,
    });
  }

  // Compute % difference from baseline
  const baseCl100k = variantResults[baselineIdx]?.avgCl100k;
  const baseO200k = variantResults[baselineIdx]?.avgO200k;
  let bestSavings = 0;

  for (const vr of variantResults) {
    vr.pctDiffCl100k = baseCl100k > 0 ? ((baseCl100k - vr.avgCl100k) / baseCl100k) * 100 : 0;
    vr.pctDiffO200k = baseO200k > 0 ? ((baseO200k - vr.avgO200k) / baseO200k) * 100 : 0;
    const avgSavings = (vr.pctDiffCl100k + vr.pctDiffO200k) / 2;
    if (avgSavings > bestSavings) bestSavings = avgSavings;
  }

  return { category: categoryName, variants: variantResults, bestSavingsPct: bestSavings };
}

// ---------------------------------------------------------------------------
// Compress all fixtures once, reuse across categories
// ---------------------------------------------------------------------------

const paktOutputs = FIXTURES.map((f) => compress(f.raw, f.opts).compressed);

// ---------------------------------------------------------------------------
// Evaluate all categories
// ---------------------------------------------------------------------------

const results: CategoryResult[] = [
  evaluateCategory('Delimiters', DELIMITER_VARIANTS, paktOutputs),
  evaluateCategory('Booleans', BOOLEAN_VARIANTS, paktOutputs),
  evaluateCategory('Whitespace/Indent', INDENT_VARIANTS, paktOutputs),
  evaluateCategory('Number Formats', NUMBER_VARIANTS, paktOutputs),
];

// ---------------------------------------------------------------------------
// Print report
// ---------------------------------------------------------------------------

console.log('');
console.log('='.repeat(80));
console.log('  L3 TOKENIZER-AWARE COMPRESSION — BENCHMARK GATE');
console.log('='.repeat(80));

/** Format a percentage with sign, e.g. "+2.3%" or "-0.1%". */
function fmtPct(val: number): string {
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

for (const cat of results) {
  console.log('');
  console.log(`--- ${cat.category} ---`);
  console.log(
    `  ${'Variant'.padEnd(28)}${'cl100k avg'.padStart(14)}${'o200k avg'.padStart(14)}${'cl100k diff'.padStart(14)}${'o200k diff'.padStart(14)}`,
  );

  for (const v of cat.variants) {
    console.log(
      `  ${v.label.padEnd(28)}${v.avgCl100k.toFixed(1).padStart(14)}${v.avgO200k.toFixed(1).padStart(14)}${fmtPct(v.pctDiffCl100k).padStart(14)}${fmtPct(v.pctDiffO200k).padStart(14)}`,
    );
  }

  console.log(`  Best savings: ${fmtPct(cat.bestSavingsPct)}`);
}

// ---------------------------------------------------------------------------
// Per-fixture breakdown (combined best-case transform)
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Per-fixture breakdown (tab delim + 1-space indent) ---');

for (const fixture of FIXTURES) {
  const pakt = compress(fixture.raw, fixture.opts).compressed;
  const baseline = countCl100k(pakt);
  const baselineO = countO200k(pakt);

  // Apply the combined best-case transform: tab delimiter + 1-space indent
  const optimized = swapIndent(swapDelimiter(pakt, '|', '\t'), ' ');
  const optTokens = countCl100k(optimized);
  const optTokensO = countO200k(optimized);

  const diffCl = baseline > 0 ? ((baseline - optTokens) / baseline) * 100 : 0;
  const diffO = baselineO > 0 ? ((baselineO - optTokensO) / baselineO) * 100 : 0;

  console.log(
    `  ${fixture.label.padEnd(24)} ` +
      `cl100k: ${String(baseline).padStart(5)} -> ${String(optTokens).padStart(5)} (${fmtPct(diffCl)})  ` +
      `o200k: ${String(baselineO).padStart(5)} -> ${String(optTokensO).padStart(5)} (${fmtPct(diffO)})`,
  );
}

// ---------------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------------

const overallBest = Math.max(...results.map((r) => r.bestSavingsPct));
const combinedSavings = (() => {
  let totalBaseCl = 0;
  let totalOptCl = 0;
  let totalBaseO = 0;
  let totalOptO = 0;

  for (const pakt of paktOutputs) {
    totalBaseCl += countCl100k(pakt);
    totalBaseO += countO200k(pakt);
    // Apply all transforms stacked: tab + 1-space + T/F + strip zeros
    const opt = stripTrailingZeros(
      swapBooleans(swapIndent(swapDelimiter(pakt, '|', '\t'), ' '), 'T', 'F'),
    );
    totalOptCl += countCl100k(opt);
    totalOptO += countO200k(opt);
  }

  const savCl = totalBaseCl > 0 ? ((totalBaseCl - totalOptCl) / totalBaseCl) * 100 : 0;
  const savO = totalBaseO > 0 ? ((totalBaseO - totalOptO) / totalBaseO) * 100 : 0;
  return (savCl + savO) / 2;
})();

const THRESHOLD = 3;
const verdict = combinedSavings >= THRESHOLD ? 'PASS' : 'FAIL';

console.log('');
console.log('='.repeat(80));
console.log(`  COMBINED SAVINGS (all transforms stacked): ${combinedSavings.toFixed(2)}%`);
console.log(`  SINGLE-CATEGORY BEST:                      ${overallBest.toFixed(2)}%`);
console.log(`  THRESHOLD:                                  ${THRESHOLD}%`);
console.log(`  VERDICT:                                    ${verdict}`);
console.log('='.repeat(80));
console.log('');

// ---------------------------------------------------------------------------
// Vitest bench — measure encode throughput for different representations
// ---------------------------------------------------------------------------

describe('L3 tokenizer gate — delimiter token cost', () => {
  const sample = paktOutputs.join('\n');
  const tabSample = swapDelimiter(sample, '|', '\t');

  bench('count tokens — pipe delimiter (baseline)', () => {
    countCl100k(sample);
  });

  bench('count tokens — tab delimiter', () => {
    countCl100k(tabSample);
  });
});

describe('L3 tokenizer gate — indent token cost', () => {
  const sample = paktOutputs.join('\n');
  const oneSpace = swapIndent(sample, ' ');

  bench('count tokens — 2-space indent (baseline)', () => {
    countCl100k(sample);
  });

  bench('count tokens — 1-space indent', () => {
    countCl100k(oneSpace);
  });
});
