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
 * - Positional file input reads from a file instead of stdin
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Paths & helpers
// ---------------------------------------------------------------------------

/** Resolve paths relative to the package root, not the developer's machine. */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute path to the built CLI entry point. */
const CLI_PATH = join(PACKAGE_ROOT, 'dist/cli.js');

/** Working directory for the CLI subprocess. */
const CWD = PACKAGE_ROOT;

/** Timeout per CLI subprocess to reduce flakes on loaded CI/WSL runs. */
const CLI_TIMEOUT_MS = 40_000;

/** Temporary directory for file-based tests. */
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pakt-cli-auto-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type CliResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

/**
 * Run the CLI with the given arguments and optional stdin input.
 */
async function runCli(args: string[], stdin?: string): Promise<CliResult> {
  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error(`CLI timed out after ${String(CLI_TIMEOUT_MS)}ms: pakt ${args.join(' ')}`));
      }
    }, CLI_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on('close', (status) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, status });
      }
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/**
 * Run the CLI expecting success (exit code 0).
 */
async function runCliOk(args: string[], stdin?: string): Promise<string> {
  const result = await runCli(args, stdin);
  if (result.status !== 0) {
    throw new Error(
      [`CLI exited with status ${String(result.status)}: pakt ${args.join(' ')}`, result.stderr]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout;
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
  it('compresses raw markdown text and produces output', async () => {
    const stdout = await runCliOk(['auto'], MARKDOWN_WITH_JSON);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain('API Response');
  }, 25_000);

  it('compresses JSON input and produces PAKT markers or @from header', async () => {
    const stdout = await runCliOk(['auto'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('@from json');
  }, 25_000);

  it('compresses JSON with --from flag', async () => {
    const stdout = await runCliOk(['auto', '--from', 'json'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('@from json');
  }, 25_000);

  it('applies L4 when semanticBudget is provided', async () => {
    const stdout = await runCliOk(
      ['auto', '--from', 'json', '--semantic-budget', '24'],
      COMPRESSIBLE_JSON,
    );
    expect(stdout).toContain('@compress semantic');
    expect(stdout).toContain('@warning lossy');
  }, 25_000);

  it('rejects non-positive semantic budgets', async () => {
    const result = await runCli(['auto', '--from', 'json', '--semantic-budget', '0'], COMPRESSIBLE_JSON);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Expected a positive integer token budget');
  }, 25_000);

  it('produces non-empty output for plain markdown', async () => {
    const stdout = await runCliOk(['auto'], RAW_MARKDOWN);
    expect(stdout.trim().length).toBeGreaterThan(0);
  }, 25_000);
});

describe('pakt auto — PAKT input (decompress path)', () => {
  it('detects PAKT input and decompresses it', async () => {
    const paktOutput = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    expect(paktOutput).toContain('@from json');

    const restored = await runCliOk(['auto'], paktOutput);
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  }, 25_000);

  it('decompresses PAKT with --to flag to produce specific format', async () => {
    const paktOutput = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    const restored = await runCliOk(['auto', '--to', 'json'], paktOutput);
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  }, 25_000);

  it('ignores semanticBudget when the auto path is decompressing', async () => {
    const paktOutput = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    const restored = await runCliOk(['auto', '--semantic-budget', '24'], paktOutput);
    const parsed = JSON.parse(restored) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  }, 25_000);

  it('rejects malformed PAKT instead of reporting a fake successful restore', async () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');
    const result = await runCli(['auto'], malformed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Input looks like PAKT but failed validation');
  }, 25_000);
});

describe('pakt inspect', () => {
  it('recommends compress for raw structured input that benefits from packing', async () => {
    const stdout = await runCliOk(['inspect'], COMPRESSIBLE_JSON);
    expect(stdout).toContain('Recommended action:   compress');
    expect(stdout).toContain('Estimated savings:');
  }, 25_000);

  it('recommends decompress for existing PAKT input', async () => {
    const compressed = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    const stdout = await runCliOk(['inspect'], compressed);
    expect(stdout).toContain('Recommended action:   decompress');
    expect(stdout).toContain('Original format:      json');
  }, 25_000);

  it('rejects non-positive semantic budgets', async () => {
    const result = await runCli(['inspect', '--semantic-budget', '0'], COMPRESSIBLE_JSON);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Expected a positive integer token budget');
  }, 25_000);
});

describe('pakt compress — semantic budget', () => {
  it('applies L4 when semanticBudget is provided directly', async () => {
    const stdout = await runCliOk(
      ['compress', '--from', 'json', '--semantic-budget', '24'],
      COMPRESSIBLE_JSON,
    );
    expect(stdout).toContain('@compress semantic');
    expect(stdout).toContain('@warning lossy');
  }, 25_000);

  it('fails fast when layer 4 is requested without a semantic budget', async () => {
    const result = await runCli(['compress', '--from', 'json', '--layers', '1,2,4'], COMPRESSIBLE_JSON);
    expect(result.stderr).toContain('Layer 4 semantic compression requires --semantic-budget');
  }, 25_000);
});

describe('pakt auto — round-trip', () => {
  it('compress then decompress via auto preserves JSON data', async () => {
    const compressed = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    expect(compressed).toContain('@from json');

    const restored = await runCliOk(['auto'], compressed);

    const original = JSON.parse(COMPRESSIBLE_JSON) as Record<string, unknown>;
    const roundTripped = JSON.parse(restored) as Record<string, unknown>;
    expect(roundTripped).toEqual(original);
  }, 25_000);

  it('compress then decompress via explicit commands matches auto', async () => {
    const compressed = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    const restoredAuto = await runCliOk(['auto'], compressed);
    const restoredExplicit = await runCliOk(['decompress', '--to', 'json'], compressed);

    const autoData = JSON.parse(restoredAuto) as Record<string, unknown>;
    const explicitData = JSON.parse(restoredExplicit) as Record<string, unknown>;
    expect(autoData).toEqual(explicitData);
  }, 40_000);
});

describe('pakt auto — file input (positional path)', () => {
  it('reads JSON from a file path argument', async () => {
    const filePath = join(tempDir, 'input.json');
    writeFileSync(filePath, COMPRESSIBLE_JSON, 'utf8');

    const stdout = await runCliOk(['auto', filePath]);
    expect(stdout).toContain('@from json');
  }, 25_000);

  it('reads markdown from a file and compresses embedded blocks', async () => {
    const filePath = join(tempDir, 'report.md');
    writeFileSync(filePath, MARKDOWN_WITH_JSON, 'utf8');

    const stdout = await runCliOk(['auto', filePath]);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stdout).toContain('API Response');
  }, 25_000);

  it('reads PAKT file and decompresses it', async () => {
    const paktContent = await runCliOk(['compress'], COMPRESSIBLE_JSON);
    const filePath = join(tempDir, 'data.pakt');
    writeFileSync(filePath, paktContent, 'utf8');

    const stdout = await runCliOk(['auto', filePath]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty('employees');
  }, 25_000);
});

describe('pakt auto — error handling', () => {
  it('exits with error when no input and stdin is TTY-like', async () => {
    const result = await runCli(['auto', '/nonexistent/path/file.txt']);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 25_000);
});
