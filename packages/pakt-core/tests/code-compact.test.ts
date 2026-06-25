import { describe, expect, it } from 'vitest';
import { createContextEngine } from '../src/context-engine/engine.js';
import { compactCode, detectCodeFamily, looksLikeCode } from '../src/layers/code-compact.js';

const MODEL = 'gpt-4o';

describe('compactCode: c-family', () => {
  it('strips line and block comments but keeps code', () => {
    const src = [
      '// header comment',
      'function add(a, b) {',
      '  /* block',
      '     comment */',
      '  return a + b; // trailing',
      '}',
    ].join('\n');
    const { text } = compactCode(src, { lang: 'c-family', model: MODEL });
    expect(text).not.toContain('header comment');
    expect(text).not.toContain('block');
    expect(text).not.toContain('trailing');
    expect(text).toContain('function add(a, b) {');
    expect(text).toContain('return a + b;');
  });

  it('never strips comment markers inside string literals', () => {
    const src = [
      'const url = "http://example.com/path"; // real comment',
      "const re = '/* not a comment */';",
      'const t = `line // still a string`;',
      'doWork(url, re, t);',
    ].join('\n');
    const { text } = compactCode(src, { lang: 'c-family', model: MODEL });
    expect(text).toContain('"http://example.com/path"');
    expect(text).toContain("'/* not a comment */'");
    expect(text).toContain('`line // still a string`');
    expect(text).not.toContain('real comment');
  });

  it('handles escaped quotes inside strings', () => {
    const src = 'const s = "a \\" // b"; // strip me\nuse(s);';
    const { text } = compactCode(src, { lang: 'c-family', model: MODEL });
    expect(text).toContain('"a \\" // b"');
    expect(text).not.toContain('strip me');
  });

  it('preserves newlines and blank lines inside template literals', () => {
    const src = ['const t = `', 'a', '', 'b', '`;', '', '', 'use(t);'].join('\n');
    const { text } = compactCode(src, { lang: 'c-family', model: MODEL });
    // The blank line inside the template survives; the double blank outside collapses.
    expect(text).toContain('`\na\n\nb\n`');
    expect(text).not.toMatch(/\n\n\nuse/);
  });
});

describe('compactCode: python', () => {
  it('strips # comments but not # inside strings', () => {
    const src = [
      '# module comment',
      'def f(x):  # inline',
      '    pattern = "# not a comment"',
      '    return x',
    ].join('\n');
    const { text } = compactCode(src, { lang: 'python', model: MODEL });
    expect(text).not.toContain('module comment');
    expect(text).not.toContain('inline');
    expect(text).toContain('"# not a comment"');
    expect(text).toContain('def f(x):');
  });

  it('preserves # inside triple-quoted strings', () => {
    const src = [
      'def f():',
      '    """',
      '    # this is documentation, not a comment',
      '    """',
      '    return 1',
    ].join('\n');
    const { text } = compactCode(src, { lang: 'python', model: MODEL });
    expect(text).toContain('# this is documentation, not a comment');
  });
});

describe('detectCodeFamily / looksLikeCode', () => {
  it('detects python vs c-family', () => {
    expect(detectCodeFamily('def f(x):\n    return x\n')).toBe('python');
    expect(detectCodeFamily('function f(x) {\n  return x;\n}\n')).toBe('c-family');
  });

  it('rejects prose and markdown as non-code', () => {
    expect(looksLikeCode('# My Heading\n\nSome prose paragraph.\n\n## Another')).toBe(false);
    expect(looksLikeCode('Just a couple\nof plain English lines.')).toBe(false);
  });

  it('accepts real code', () => {
    expect(looksLikeCode('function f(a) {\n  return a + 1;\n}\n')).toBe(true);
    expect(looksLikeCode('def f(a):\n    if a:\n        return a\n')).toBe(true);
  });

  it('returns the original when there is nothing to strip', () => {
    const src = 'const x = 1;\nconst y = 2;\nuse(x, y);';
    const { text, savedTokens } = compactCode(src, { lang: 'c-family', model: MODEL });
    expect(text).toBe(src);
    expect(savedTokens).toBe(0);
  });
});

describe('code-compact: engine integration', () => {
  it('compacts old code tool results when compactCode is enabled', () => {
    const code = [
      '// fetch the user record and validate it',
      'async function loadUser(id) {',
      '  // look it up',
      '  const u = await db.find(id);',
      '',
      '',
      '  // guard against missing',
      '  if (!u) throw new Error("not found");',
      '  return u;',
      '}',
    ].join('\n');
    const engine = createContextEngine({
      maxContextTokens: 1_000_000,
      compactCode: true,
      recentTurns: 1,
      minToolResultTokens: 20,
    });
    engine.addMessage({ role: 'user', content: 'open the user loader' });
    engine.addToolResult('read_file', code);
    for (let i = 0; i < 3; i++) {
      engine.addMessage({ role: 'user', content: `next ${String(i)}` });
    }

    const { savings, messages } = engine.optimize();
    expect(savings.breakdown.codeCompaction).toBeGreaterThan(0);
    const file = messages.find((m) => m.role === 'tool');
    expect(file?.content).not.toContain('guard against missing');
    expect(file?.content).toContain('async function loadUser(id)');
  });

  it('is off by default and never touches markdown', () => {
    const md = '# Title\n\n## Section\n\nText with a `code` span and more.\n\nMore text.';
    const engine = createContextEngine({
      maxContextTokens: 1_000_000,
      compactCode: true,
      recentTurns: 1,
    });
    engine.addMessage({ role: 'user', content: 'read the doc' });
    engine.addToolResult('read_file', md);
    for (let i = 0; i < 3; i++) engine.addMessage({ role: 'user', content: `n${String(i)}` });

    const { savings, messages } = engine.optimize();
    // Markdown is excluded — headings must survive untouched.
    expect(savings.breakdown.codeCompaction).toBe(0);
    const doc = messages.find((m) => m.role === 'tool');
    expect(doc?.content).toContain('# Title');
    expect(doc?.content).toContain('## Section');
  });
});
