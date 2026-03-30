import { describe, expect, it } from 'vitest';
import { interpretModelOutput } from '../src/index.js';

const VALID_PAKT = ['@from json', 'user:', '  name: Alice', '  role: dev'].join('\n');

describe('interpretModelOutput', () => {
  it('passes through non-PAKT responses unchanged', () => {
    const response = 'Here is the summary: Alice is still on the engineering team.';
    const result = interpretModelOutput(response);

    expect(result.action).toBe('passthrough');
    expect(result.text).toBe(response);
    expect(result.data).toBe(response);
    expect(result.candidateText).toBeUndefined();
  });

  it('decompresses a direct PAKT response', () => {
    const result = interpretModelOutput(VALID_PAKT, { outputFormat: 'json' });

    expect(result.action).toBe('decompressed');
    expect(result.originalFormat).toBe('json');
    expect(result.text).toContain('"user"');
    expect(result.text).toContain('"Alice"');
    expect(result.extractedFromFence).toBe(false);
  });

  it('extracts and decompresses a fenced PAKT block from a model response', () => {
    const response = ['Updated payload:', '', '```pakt', VALID_PAKT, '```'].join('\n');
    const result = interpretModelOutput(response, { outputFormat: 'json' });

    expect(result.action).toBe('decompressed');
    expect(result.extractedFromFence).toBe(true);
    expect(result.text).toContain('"role"');
    expect(result.text).toContain('"dev"');
  });

  it('recovers when a model prefixes prose before an inline PAKT reply', () => {
    const response = ['Here is the updated payload:', VALID_PAKT].join('\n');
    const result = interpretModelOutput(response, { outputFormat: 'json' });

    expect(result.action).toBe('decompressed');
    expect(result.text).toContain('"user"');
    expect(result.text).toContain('"Alice"');
  });

  it('repairs minor PAKT issues before decompressing', () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');
    const result = interpretModelOutput(malformed, { outputFormat: 'json' });

    expect(result.action).toBe('repaired-decompressed');
    expect(result.repaired).toBe(true);
    expect(result.text).toContain('"role"');
    expect(result.text).toContain('"dev"');
  });

  it('reports invalid-pakt when validation fails and repair cannot recover', () => {
    const invalid = ['@from json', '@dict', '  $a: dev', '@end', 'role: $z'].join('\n');
    const result = interpretModelOutput(invalid, { outputFormat: 'json' });

    expect(result.action).toBe('invalid-pakt');
    expect(result.text).toBe(invalid);
    expect(result.validation?.valid).toBe(false);
    expect(result.validation?.errors.some((error) => error.code === 'E005')).toBe(true);
  });

  it('can disable repair attempts explicitly', () => {
    const malformed = ['@from json', '@dict', '  $a: dev', 'role: $a'].join('\n');
    const result = interpretModelOutput(malformed, {
      outputFormat: 'json',
      attemptRepair: false,
    });

    expect(result.action).toBe('invalid-pakt');
    expect(result.repaired).toBe(false);
  });
});
