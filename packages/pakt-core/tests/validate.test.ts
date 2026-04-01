/**
 * Tests for the PAKT validation and auto-repair utilities.
 */
import { describe, expect, it } from 'vitest';
import { repair, validate } from '../src/utils/validate.js';

// ===========================================================================
// 1. validate() — valid documents
// ===========================================================================

describe('validate: valid documents pass', () => {
  it('accepts a minimal valid PAKT document', () => {
    const pakt = '@from json\nname: Alice';
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a document with dict block and body', () => {
    const pakt = ['@from json', '@dict', '  $a: developer', '@end', 'role: $a'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a document with tabular array and correct counts', () => {
    const pakt = ['@from json', 'users [2]{name|role}:', '  Alice|dev', '  Bob|designer'].join(
      '\n',
    );
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a document with inline array and correct count', () => {
    const pakt = '@from csv\ntags [3]: React,TypeScript,Rust';
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a document with comments', () => {
    const pakt = ['@from yaml', '% This is a comment', 'name: Alice'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts a full PAKT document with headers, dict, and body', () => {
    const pakt = [
      '@from json',
      '@version 0.1.0',
      '@dict',
      '  $a: developer',
      '  $b: active',
      '@end',
      'name: Sriinnu',
      'role: $a',
      'status: $b',
      'projects [2]{id|name}:',
      '  1|VAAYU',
      '  2|ClipForge',
      'tags [3]: React,TypeScript,Rust',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ===========================================================================
// 2. validate() — missing @from header
// ===========================================================================

describe('validate: missing @from header', () => {
  it('reports error for missing @from header', () => {
    const pakt = 'name: Alice';
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E001')).toBe(true);
  });

  it('reports error for @from with no value', () => {
    const pakt = '@from\nname: Alice';
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E002')).toBe(true);
  });

  it('reports error for @from with unknown format', () => {
    const pakt = '@from xml\nname: Alice';
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E002')).toBe(true);
    expect(result.errors[0]?.message).toContain('xml');
  });
});

// ===========================================================================
// 3. validate() — dict block errors
// ===========================================================================

describe('validate: dict block errors', () => {
  it('reports error for missing @end', () => {
    const pakt = ['@from json', '@dict', '  $a: developer', 'name: $a'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E003')).toBe(true);
  });

  it('reports error for @end without @dict', () => {
    const pakt = ['@from json', '@end', 'name: Alice'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E003')).toBe(true);
  });
});

// ===========================================================================
// 4. validate() — unused alias warnings
// ===========================================================================

describe('validate: unused alias warnings', () => {
  it('warns about unused dictionary alias', () => {
    const pakt = [
      '@from json',
      '@dict',
      '  $a: developer',
      '  $b: designer',
      '@end',
      'role: $a',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === 'W001' && w.message.includes('$b'))).toBe(true);
  });

  it('does not warn when all aliases are used', () => {
    const pakt = ['@from json', '@dict', '  $a: developer', '@end', 'role: $a'].join('\n');
    const result = validate(pakt);
    expect(result.warnings.filter((w) => w.code === 'W001')).toHaveLength(0);
  });
});

// ===========================================================================
// 5. validate() — undefined alias errors
// ===========================================================================

describe('validate: undefined alias errors', () => {
  it('reports error for undefined alias used in body', () => {
    const pakt = ['@from json', '@dict', '  $a: developer', '@end', 'role: $z'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E005' && e.message.includes('$z'))).toBe(true);
  });

  it('reports error when no dict block exists but aliases are used', () => {
    const pakt = ['@from json', 'role: $a'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E005' && e.message.includes('$a'))).toBe(true);
  });

  it('reports the exact line and column for the first undefined alias occurrence', () => {
    const pakt = ['@from json', '  role: $z', 'name: $z'].join('\n');
    const result = validate(pakt);
    const error = result.errors.find(
      (entry) => entry.code === 'E005' && entry.message.includes('$z'),
    );

    expect(error).toMatchObject({ line: 2, column: 9 });
  });

  it('reports inline-array alias locations using the first occurrence', () => {
    const pakt = ['@from json', 'tags [2]: $missing,$missing'].join('\n');
    const result = validate(pakt);
    const error = result.errors.find(
      (entry) => entry.code === 'E005' && entry.message.includes('$missing'),
    );

    expect(error).toMatchObject({ line: 2, column: 11 });
  });
});

// ===========================================================================
// 6. validate() — tabular array count mismatch
// ===========================================================================

describe('validate: tabular array count mismatch', () => {
  it('reports error when declared count exceeds actual rows', () => {
    const pakt = ['@from json', 'users [3]{name|role}:', '  Alice|dev', '  Bob|designer'].join(
      '\n',
    );
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E007' && e.message.includes('[3]'))).toBe(true);
  });

  it('reports error when actual rows exceed declared count', () => {
    const pakt = ['@from json', 'users [1]{name|role}:', '  Alice|dev', '  Bob|designer'].join(
      '\n',
    );
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E007')).toBe(true);
  });
});

// ===========================================================================
// 7. validate() — trailing whitespace warning
// ===========================================================================

describe('validate: trailing whitespace', () => {
  it('warns about trailing whitespace', () => {
    const pakt = '@from json\nname: Alice   ';
    const result = validate(pakt);
    expect(result.warnings.some((w) => w.code === 'W003')).toBe(true);
  });

  it('does not warn when there is no trailing whitespace', () => {
    const pakt = '@from json\nname: Alice';
    const result = validate(pakt);
    expect(result.warnings.filter((w) => w.code === 'W003')).toHaveLength(0);
  });
});

// ===========================================================================
// 8. validate() — row field count mismatch
// ===========================================================================

describe('validate: row field count mismatch', () => {
  it('reports error when row has fewer fields than header', () => {
    const pakt = [
      '@from json',
      'users [2]{name|role|active}:',
      '  Alice|dev',
      '  Bob|designer|true',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E006')).toBe(true);
  });

  it('reports error when row has more fields than header', () => {
    const pakt = [
      '@from json',
      'users [2]{name|role}:',
      '  Alice|dev|extra',
      '  Bob|designer',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E006')).toBe(true);
  });
});

// ===========================================================================
// 9. validate() — inline array count mismatch
// ===========================================================================

describe('validate: inline array count mismatch', () => {
  it('reports error when inline array count is wrong', () => {
    const pakt = '@from json\ntags [5]: React,TypeScript,Rust';
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E007' && e.message.includes('tags'))).toBe(true);
  });
});

// ===========================================================================
// 10. validate() — indentation warnings
// ===========================================================================

describe('validate: indentation warnings', () => {
  it('warns about odd indentation', () => {
    const pakt = '@from json\n   name: Alice';
    const result = validate(pakt);
    expect(result.warnings.some((w) => w.code === 'W002')).toBe(true);
  });

  it('does not warn for even indentation', () => {
    const pakt = '@from json\n  name: Alice';
    const result = validate(pakt);
    expect(result.warnings.filter((w) => w.code === 'W002')).toHaveLength(0);
  });

  it('requires @warning lossy when semantic compression is declared', () => {
    const pakt = ['@from json', '@compress semantic', 'users [1]{name}:', '  Alice'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.code === 'E008' &&
          e.message.includes('@compress semantic requires a matching @warning lossy'),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// 11. repair() — fix missing @end
// ===========================================================================

describe('repair: fix missing @end', () => {
  it('adds missing @end for unclosed @dict block', () => {
    const malformed = ['@from json', '@dict', '  $a: developer', 'name: $a'].join('\n');
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('@end');
    // Validate the repaired output
    const result = validate(fixed!);
    expect(result.errors.filter((e) => e.code === 'E003')).toHaveLength(0);
  });

  it('adds @end at end of file if dict is last block', () => {
    const malformed = ['@from json', '@dict', '  $a: developer'].join('\n');
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed?.trimEnd().endsWith('@end')).toBe(true);
  });
});

// ===========================================================================
// 12. repair() — fix trailing whitespace
// ===========================================================================

describe('repair: fix trailing whitespace', () => {
  it('strips trailing whitespace from all lines', () => {
    const malformed = '@from json  \nname: Alice   \nage: 30  ';
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    const lines = fixed?.split('\n');
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }
  });
});

// ===========================================================================
// 13. repair() — fix count mismatch
// ===========================================================================

describe('repair: fix count mismatch', () => {
  it('fixes tabular array count mismatch', () => {
    const malformed = ['@from json', 'users [5]{name|role}:', '  Alice|dev', '  Bob|designer'].join(
      '\n',
    );
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('[2]');
    expect(fixed).not.toContain('[5]');
  });

  it('fixes inline array count mismatch', () => {
    const malformed = '@from json\ntags [10]: React,TypeScript,Rust';
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('[3]');
    expect(fixed).not.toContain('[10]');
  });

  it('fixes list array count mismatch', () => {
    const malformed = ['@from json', 'events [5]:', '  - type: deploy', '  - type: rollback'].join(
      '\n',
    );
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('[2]');
    expect(fixed).not.toContain('[5]');
  });
});

// ===========================================================================
// 14. repair() — fix mixed delimiters
// ===========================================================================

describe('repair: fix mixed delimiters', () => {
  it('converts comma-delimited rows to pipe-delimited', () => {
    const malformed = ['@from json', 'users [2]{name|role}:', '  Alice,dev', '  Bob,designer'].join(
      '\n',
    );
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('Alice|dev');
    expect(fixed).toContain('Bob|designer');
  });

  it('does not corrupt correctly pipe-delimited rows', () => {
    const correct = ['@from json', 'users [2]{name|role}:', '  Alice|dev', '  Bob|designer'].join(
      '\n',
    );
    const fixed = repair(correct);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('Alice|dev');
    expect(fixed).toContain('Bob|designer');
  });
});

// ===========================================================================
// 15. repair() — normalize indentation
// ===========================================================================

describe('repair: normalize indentation', () => {
  it('normalizes odd indentation to even 2-space', () => {
    const malformed = ['@from json', 'user', '   name: Alice', '   age: 30'].join('\n');
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    // 3 spaces should round to 4 (2*2)
    expect(fixed).toContain('    name: Alice');
  });

  it('preserves correct 2-space indentation', () => {
    const correct = ['@from json', 'user', '  name: Alice'].join('\n');
    const fixed = repair(correct);
    expect(fixed).not.toBeNull();
    expect(fixed).toContain('  name: Alice');
  });
});

// ===========================================================================
// 16. repair() — return null for garbage input
// ===========================================================================

describe('repair: return null for garbage input', () => {
  it('returns null for empty string', () => {
    expect(repair('')).toBeNull();
  });

  it('returns null for completely unrecognizable input', () => {
    expect(repair('!!! random garbage $$$ ???')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(repair('   \n  \n  ')).toBeNull();
  });
});

// ===========================================================================
// 17. validate() — edge cases
// ===========================================================================

describe('validate: edge cases', () => {
  it('handles empty string', () => {
    const result = validate('');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E001')).toBe(true);
  });

  it('handles CRLF line endings', () => {
    const pakt = '@from json\r\nname: Alice\r\n';
    const result = validate(pakt);
    expect(result.valid).toBe(true);
  });

  it('handles multiple tabular arrays', () => {
    const pakt = [
      '@from json',
      'users [1]{name|role}:',
      '  Alice|dev',
      'scores [2]{id|val}:',
      '  1|100',
      '  2|200',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
  });

  it('handles aliases used in tabular rows', () => {
    const pakt = [
      '@from json',
      '@dict',
      '  $a: developer',
      '@end',
      'users [1]{name|role}:',
      '  Alice|$a',
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
    expect(result.warnings.filter((w) => w.code === 'W001')).toHaveLength(0);
  });
});

// ===========================================================================
// 18. repair() — combined fixes
// ===========================================================================

describe('repair: combined fixes', () => {
  it('applies multiple fixes at once', () => {
    const malformed = [
      '@from json  ', // trailing whitespace
      '@dict',
      '  $a: developer', // no @end
      'users [5]{name|role}:', // wrong count
      '  Alice,dev', // comma delimiter
      '  Bob,designer', // comma delimiter
    ].join('\n');
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();

    // Check trailing whitespace removed
    const lines = fixed?.split('\n');
    for (const line of lines) {
      expect(line).toBe(line.trimEnd());
    }

    // Check @end was added
    expect(fixed).toContain('@end');

    // Check count was fixed
    expect(fixed).toContain('[2]');
    expect(fixed).not.toContain('[5]');

    // Check delimiters were fixed
    expect(fixed).toContain('Alice|dev');
  });
});

// ===========================================================================
// 19. validate() — list array count check
// ===========================================================================

describe('validate: list array count mismatch', () => {
  it('reports error for list array with wrong item count', () => {
    const pakt = ['@from json', 'events [3]:', '  - type: deploy', '  - type: rollback'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'E007' && e.message.includes('events'))).toBe(true);
  });

  it('passes for list array with correct item count', () => {
    const pakt = ['@from json', 'events [2]:', '  - type: deploy', '  - type: rollback'].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// 20. validate() — multiple errors and warnings combined
// ===========================================================================

describe('validate: multiple issues at once', () => {
  it('collects multiple errors and warnings', () => {
    const pakt = [
      '@dict', // missing @from; @dict without @end handled below
      '  $a: developer',
      '  $b: unused',
      'role: $z', // undefined $z; triggers @end insertion
      'name: Alice  ', // trailing whitespace
    ].join('\n');
    const result = validate(pakt);
    expect(result.valid).toBe(false);
    // Should have errors: missing @from (E001), missing @end (E003), undefined $z (E005)
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    // Should have warnings: unused $b (W001) or $a (W001), trailing whitespace (W003)
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 21. validate() — known format variants
// ===========================================================================

describe('validate: all known formats accepted', () => {
  const formats = ['json', 'yaml', 'csv', 'markdown', 'pakt', 'text'];

  for (const fmt of formats) {
    it(`accepts @from ${fmt}`, () => {
      const pakt = `@from ${fmt}\nname: test`;
      const result = validate(pakt);
      expect(result.errors.filter((e) => e.code === 'E002')).toHaveLength(0);
    });
  }
});

// ===========================================================================
// 22. repair() — handles tab characters
// ===========================================================================

describe('repair: tab handling', () => {
  it('converts tab indentation to 2-space', () => {
    const malformed = '@from json\nuser\n\t\tname: Alice';
    const fixed = repair(malformed);
    expect(fixed).not.toBeNull();
    // Tabs converted, content should be indented with spaces
    expect(fixed).not.toContain('\t');
    expect(fixed).toContain('    name: Alice');
  });
});
