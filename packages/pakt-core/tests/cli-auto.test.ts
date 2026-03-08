/**
 * Tests for the `pakt auto` CLI subcommand.
 *
 * Exercises the auto-detect + compress/decompress flow by spawning the CLI
 * as a child process. This validates the full end-to-end path: argv parsing,
 * format detection, compression, decompression, and file I/O.
 *
 * Test strategy:
 * - Raw (non-PAKT) input piped via stdin -> auto detects as non-pakt -> compresses
 * - Already-PAKT input piped via stdin -> auto detects as pakt -> decompresses
 * - JSON input -> compresses -> output contains PAKT markers
 * - Round-trip: auto compress then auto decompress recovers original data
 * - `--file` flag reads from a file instead of stdin
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Note: CLI subprocess tests are slow (2-5 s each) due to Node.js cold-start
 * + BPE tokeniser initialisation. The global testTimeout in vitest.config.ts
 * is set to 15 s to prevent flakes on CI and WSL environments.
 */

// ---------------------------------------------------------------------------
// Paths & helpers
// ---------------------------------------------------------------------------

/** Resolve paths relative to the package root, not the developer's machine. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path to the built CLI entry point. */
const CLI_PATH = join(PACKAGE_ROOT, 'dist/cli.js');

/** Working directory for the CLI subprocess. */
const CWD = PACKAGE_ROOT;

/** Temporary directory for file-based tests. */
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pakt-cli-auto-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Run the CLI with the given arguments and optional stdin input.
 *
 * @param args - CLI arguments (e.g., ['auto', '--from', 'json'])
 * @param stdin - Optional string to pipe as stdin
 * @returns Object with stdout and stderr strings
 */
function runCli(args: string[], stdin?: string): { stdout: string; stderr: string } {
  const cmd = `node ${CLI_PATH} ${args.join(' ')}`;
  try {
    const stdout = execSync(cmd, {
      cwd: CWD,
      input: stdin,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '' };
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    // The CLI writes savings info to stderr, which is normal (not an error).
    // execSync only throws if the process exits non-zero.
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? '',
    };
  }
}

/**
 * Run the CLI expecting success (exit 0). Uses a wrapper that captures
 * stderr without treating it as failure.
 *
 * @param args - CLI arguments
 * @param stdin - Optional stdin input
 * @returns stdout string
 */
function runCliOk(args: string[], stdin?: string): string {
  const cmd = `node ${CLI_PATH} ${args.join(' ')}`;
  // execSync captures stdout. stderr goes to parent by default.
  // We redirect stderr to /dev/null so it does not cause throw.
  const stdout = execSync(`${cmd} 2>/dev/null`, {
    cwd: CWD,
    input: stdin,
    encoding: 'utf8',
    timeout: 15_000,
  });
  return stdout;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

/** Markdown text that is clearly not PAKT. */
const RAW_MARKDOWN = [
  '# Project Status',
  '',
  'The project is on track for Q2 delivery.',
  'All milestones have been met so far.',
  '',
  '## Next Steps',
  '',
  '- Finalize API design',
  '- Write integration tests',
  '- Deploy staging environment',
].join('\n');

/** JSON with enough repetition to produce meaningful compression. */
const COMPRESSIBLE_JSON = JSON.stringify({
  employees: Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    name: `employee_${String(i + 1)}`,
    department: 'engineering',
    status: 'active',
    level: 'senior',
  })),
});

/** Markdown with an embedded JSON fenced code block. */
const MARKDOWN_WITH_JSON = [
  '# API Response',
  '',
  '```json',
  COMPRESSIBLE_JSON,
  '```',
  '',
  'End of report.',
].join('\n');

// ===========================================================================
// Tests
// ===========================================================================

describe('pakt auto — raw input (compress path)', () => {
  it('compresses raw markdown text and produces output', () => {
    const stdout = runCliOk(['auto'], MARKDOWN_WITH_JSON);
    // Auto on non-pakt input should produce some output
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain('API Response');
  });

  it('compresses JSON input and produces PAKT markers or @from header', () => {
    const stdout = runCliOk(['auto'], COMPRESSIBLE_JSON);
    // When auto compresses JSON, result should have @from json header
    expect(stdout).toContain('@from json');
  });

  it('compresses JSON with --from flag', () => {
    const stdout = runCliOk(['auto', '--from', 'json'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('@from json');
  });

  it('applies L4 when semanticBudget is provided', () => {
    const stdout = runCliOk(['auto', '--from', 'json', '--semantic-budget', '24'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('@compress semantic');
    expect(stdout).toContain('@warning lossy');
  });

  it('produces non-empty output for plain markdown', () => {
    const stdout = runCliOk(['auto'], RAW_MARKDOWN);
    // Plain markdown has no structured blocks, so compressMixed
    // returns it mostly as-is (passthrough)
    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});

describe('pakt auto — PAKT input (decompress path)', () => {
  it('detects PAKT input and decompresses it', () => {
    // First compress some JSON to get PAKT output
    const paktOutput = runCliOk(['compress'], COMPRESSIBLE_JSON);
    expect(paktOutput).toContain('@from json');

    // Now feed the PAKT output back through auto — it should decompress
    const restored = runCliOk(['auto'], paktOutput);
    // The restored output should be valid JSON
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  });

  it('decompresses PAKT with --to flag to produce specific format', () => {
    const paktOutput = runCliOk(['compress'], COMPRESSIBLE_JSON);

    // Auto decompress with --to json
    const restored = runCliOk(['auto', '--to', 'json'], paktOutput);
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  });

  it('ignores semanticBudget when the auto path is decompressing', () => {
    const paktOutput = runCliOk(['compress'], COMPRESSIBLE_JSON);
    const restored = runCliOk(['auto', '--semantic-budget', '24'], paktOutput);
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  });
});

describe('pakt compress — semantic budget', () => {
  it('applies L4 when semanticBudget is provided directly', () => {
    const stdout = runCliOk(['compress', '--from', 'json', '--semantic-budget', '24'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('@compress semantic');
    expect(stdout).toContain('@warning lossy');
  });

  it('fails fast when layer 4 is requested without a semantic budget', () => {
    const result = runCli(['compress', '--from', 'json', '--layers', '1,2,4'], COMPRESSIBLE_JSON);
    expect(result.stderr).toContain('Layer 4 semantic compression requires --semantic-budget');
  });
});

describe('pakt auto — round-trip', () => {
  it('compress then decompress via auto preserves JSON data', () => {
    // Step 1: compress via explicit command (produces clean @from header)
    const compressed = runCliOk(['compress'], COMPRESSIBLE_JSON);
    expect(compressed).toContain('@from json');

    // Step 2: auto decompress the result (auto detects PAKT -> decompresses)
    const restored = runCliOk(['auto'], compressed);

    // Step 3: parse both and compare
    const original = JSON.parse(COMPRESSIBLE_JSON) as Record<string, unknown>;
    const roundTripped = JSON.parse(restored) as Record<string, unknown>;
    expect(roundTripped).toEqual(original);
  });

  it('compress then decompress via explicit commands matches auto', () => {
    // Compress via explicit command
    const compressed = runCliOk(['compress'], COMPRESSIBLE_JSON);

    // Decompress via auto
    const restoredAuto = runCliOk(['auto'], compressed);

    // Decompress via explicit command
    const restoredExplicit = runCliOk(['decompress', '--to', 'json'], compressed);

    // Both should produce equivalent JSON
    const autoData = JSON.parse(restoredAuto) as Record<string, unknown>;
    const explicitData = JSON.parse(restoredExplicit) as Record<string, unknown>;
    expect(autoData).toEqual(explicitData);
  });
});

describe('pakt auto — file input (--file flag)', () => {
  it('reads JSON from a file path argument', () => {
    const filePath = join(tempDir, 'input.json');
    writeFileSync(filePath, COMPRESSIBLE_JSON, 'utf8');

    // The CLI uses positional arg for file, not --file flag
    const stdout = runCliOk(['auto', filePath]);
    expect(stdout).toContain('@from json');
  });

  it('reads markdown from a file and compresses embedded blocks', () => {
    const filePath = join(tempDir, 'report.md');
    writeFileSync(filePath, MARKDOWN_WITH_JSON, 'utf8');

    const stdout = runCliOk(['auto', filePath]);
    expect(stdout.length).toBeGreaterThan(0);
    // Should still contain the prose parts
    expect(stdout).toContain('API Response');
  });

  it('reads PAKT file and decompresses it', () => {
    // First create a PAKT file
    const paktContent = runCliOk(['compress'], COMPRESSIBLE_JSON);
    const filePath = join(tempDir, 'data.pakt');
    writeFileSync(filePath, paktContent, 'utf8');

    // Then auto on the PAKT file should decompress
    const stdout = runCliOk(['auto', filePath]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  });
});

describe('pakt auto — error handling', () => {
  it('exits with error when no input and stdin is TTY-like', () => {
    // Running without piped input and no file should fail
    // (In test environment stdin may not be TTY, so we test with nonexistent file)
    const result = runCli(['auto', '/nonexistent/path/file.txt']);
    // Should have non-empty stderr with error message
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
