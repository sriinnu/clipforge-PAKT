/**
 * @module tests/proxy-tokenize-cmd
 * Unit tests for the quote-aware command tokenizer in cli-proxy.ts (P2-10).
 *
 * Regression: `wrapCommand.split(/\s+/)` would break paths with spaces or
 * any quoted arguments. `tokenizeCommand` handles single/double-quoted
 * substrings and backslash-escapes inside double quotes.
 */

import { describe, expect, it } from 'vitest';
import { tokenizeCommand } from '../src/cli-proxy.js';

describe('tokenizeCommand — quote-aware splitting', () => {
  it('splits plain whitespace-delimited tokens', () => {
    expect(tokenizeCommand('npx my-server --stdio')).toEqual([
      'npx', 'my-server', '--stdio',
    ]);
  });

  it('handles multiple spaces between tokens', () => {
    expect(tokenizeCommand('cmd   arg1  arg2')).toEqual(['cmd', 'arg1', 'arg2']);
  });

  it('preserves spaces inside double-quoted argument', () => {
    expect(tokenizeCommand('cmd "path with spaces"')).toEqual([
      'cmd', 'path with spaces',
    ]);
  });

  it('preserves spaces inside single-quoted argument', () => {
    expect(tokenizeCommand("cmd '/opt/my tool' --flag")).toEqual([
      'cmd', '/opt/my tool', '--flag',
    ]);
  });

  it('handles escaped double-quote inside double-quoted string', () => {
    expect(tokenizeCommand('cmd "say \\"hello\\" world"')).toEqual([
      'cmd', 'say "hello" world',
    ]);
  });

  it('handles escaped backslash inside double-quoted string', () => {
    expect(tokenizeCommand('cmd "C:\\\\Users\\\\foo"')).toEqual([
      'cmd', 'C:\\Users\\foo',
    ]);
  });

  it('handles adjacent quoted + unquoted segments', () => {
    expect(tokenizeCommand('cmd pre"mid"suf')).toEqual(['cmd', 'premidsuf']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenizeCommand('')).toEqual([]);
  });

  it('returns single token for no-whitespace string', () => {
    expect(tokenizeCommand('npx-chitragupta')).toEqual(['npx-chitragupta']);
  });

  it('handles tabs as whitespace', () => {
    expect(tokenizeCommand('cmd\targ1\targ2')).toEqual(['cmd', 'arg1', 'arg2']);
  });

  it('handles command with full quoted path (regression for paths with spaces)', () => {
    const input = '"/usr/local/bin/my mcp server" --stdio';
    expect(tokenizeCommand(input)).toEqual(['/usr/local/bin/my mcp server', '--stdio']);
  });

  it('single-quoted string: no escape processing (backslash is literal)', () => {
    expect(tokenizeCommand("cmd 'back\\slash'")).toEqual(['cmd', 'back\\slash']);
  });
});
