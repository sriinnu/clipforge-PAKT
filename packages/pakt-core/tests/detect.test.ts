import { describe, it, expect } from 'vitest';
import { detect } from '../src/detect.js';

// ---------------------------------------------------------------------------
// Helper: assert format and minimum confidence
// ---------------------------------------------------------------------------

function expectFormat(input: string, format: string, minConfidence = 0) {
  const result = detect(input);
  expect(result.format).toBe(format);
  if (minConfidence > 0) {
    expect(result.confidence).toBeGreaterThanOrEqual(minConfidence);
  }
  expect(result.reason).toBeTruthy();
  return result;
}

// ===========================================================================
// 1. JSON Detection
// ===========================================================================

describe('JSON detection', () => {
  it('detects a valid JSON object', () => {
    expectFormat('{"key": "value"}', 'json', 0.99);
  });

  it('detects a valid JSON array', () => {
    expectFormat('[1, 2, 3]', 'json', 0.99);
  });

  it('detects minified JSON', () => {
    expectFormat('{"a":1,"b":2,"c":[3,4]}', 'json', 0.99);
  });

  it('detects pretty-printed JSON', () => {
    const input = `{
  "name": "Alice",
  "age": 30,
  "hobbies": ["reading", "coding"]
}`;
    expectFormat(input, 'json', 0.99);
  });

  it('detects deeply nested JSON', () => {
    const input = '{"a":{"b":{"c":{"d":{"e":"deep"}}}}}';
    expectFormat(input, 'json', 0.99);
  });

  it('detects JSON array of objects', () => {
    const input = '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]';
    expectFormat(input, 'json', 0.99);
  });

  it('detects JSON with comments (JSONC)', () => {
    const input = `{
  // This is a comment
  "name": "Alice",
  /* multi-line
     comment */
  "age": 30
}`;
    expectFormat(input, 'json', 0.95);
  });

  it('detects malformed JSON with low confidence', () => {
    const input = '{"key": "value", "broken": }';
    const result = detect(input);
    // Should be json but with low confidence, or some other format
    // The key thing: starts with { so it should be detected as json
    expect(result.format).toBe('json');
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('gives high confidence for empty JSON object', () => {
    expectFormat('{}', 'json', 0.99);
  });

  it('gives high confidence for empty JSON array', () => {
    expectFormat('[]', 'json', 0.99);
  });
});

// ===========================================================================
// 2. PAKT Detection
// ===========================================================================

describe('PAKT detection', () => {
  it('detects @from header', () => {
    const input = '@from json\nname|age\nAlice|30';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects @dict header', () => {
    const input = '@dict\n$a=developer\n$b=designer\nrole:$a';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects @version header', () => {
    const input = '@version 1\n@from yaml\nkey:value';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects @compress header', () => {
    const input = '@compress L1+L2\ndata|here';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects @warning header', () => {
    const input = '@warning lossy\nsome compressed data';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects @target header', () => {
    const input = '@target gpt-4o\n@from json\ndata|here';
    expectFormat(input, 'pakt', 1.0);
  });

  it('detects tabular array syntax', () => {
    const input = 'users [3]{name|age|role}:\nAlice|30|dev\nBob|25|pm\nCarol|35|lead';
    expectFormat(input, 'pakt', 1.0);
  });

  it('PAKT wins over YAML-like content', () => {
    const input = '@from yaml\nname: Alice\nage: 30';
    const result = detect(input);
    expect(result.format).toBe('pakt');
    expect(result.confidence).toBe(1.0);
  });

  it('PAKT wins over JSON-like content', () => {
    const input = '@from json\n{"name": "Alice"}';
    const result = detect(input);
    expect(result.format).toBe('pakt');
    expect(result.confidence).toBe(1.0);
  });
});

// ===========================================================================
// 3. CSV Detection
// ===========================================================================

describe('CSV detection', () => {
  it('detects comma-separated values', () => {
    const input = 'id,name,role\n1,Alice,dev\n2,Bob,pm\n3,Carol,lead';
    expectFormat(input, 'csv', 0.85);
  });

  it('detects tab-separated values', () => {
    const input = 'id\tname\trole\n1\tAlice\tdev\n2\tBob\tpm\n3\tCarol\tlead';
    expectFormat(input, 'csv', 0.85);
  });

  it('detects semicolon-separated values', () => {
    const input = 'id;name;role\n1;Alice;dev\n2;Bob;pm\n3;Carol;lead';
    expectFormat(input, 'csv', 0.85);
  });

  it('detects CSV with quoted fields', () => {
    const input = 'name,description,price\n"Widget A","A nice, shiny widget",9.99\n"Widget B","Another widget",19.99';
    expectFormat(input, 'csv', 0.85);
  });

  it('detects CSV with many rows (higher confidence)', () => {
    const lines = ['name,age,city'];
    for (let i = 0; i < 10; i++) {
      lines.push(`Person${i},${20 + i},City${i}`);
    }
    const result = detect(lines.join('\n'));
    expect(result.format).toBe('csv');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does not detect CSV with only 2 lines', () => {
    const input = 'name,age\nAlice,30';
    const result = detect(input);
    // With only 2 lines, CSV detection should not trigger (needs 3+)
    expect(result.format).not.toBe('csv');
  });

  it('requires at least 2 columns', () => {
    const input = 'name\nAlice\nBob\nCarol';
    const result = detect(input);
    expect(result.format).not.toBe('csv');
  });
});

// ===========================================================================
// 4. YAML Detection
// ===========================================================================

describe('YAML detection', () => {
  it('detects key-value pairs', () => {
    const input = 'name: Alice\nage: 30\nrole: developer';
    expectFormat(input, 'yaml', 0.7);
  });

  it('detects nested YAML', () => {
    const input = `person:
  name: Alice
  age: 30
  address:
    city: Portland
    state: OR`;
    expectFormat(input, 'yaml', 0.7);
  });

  it('detects YAML with --- document separator', () => {
    const input = '---\nname: Alice\nage: 30';
    expectFormat(input, 'yaml', 0.85);
  });

  it('detects multi-document YAML', () => {
    const input = '---\nname: Alice\n---\nname: Bob';
    expectFormat(input, 'yaml', 0.8);
  });

  it('detects YAML with lists', () => {
    const input = `fruits:
  - apple
  - banana
  - cherry`;
    expectFormat(input, 'yaml', 0.7);
  });

  it('detects single-line YAML with low confidence', () => {
    const input = 'name: Alice';
    const result = detect(input);
    expect(result.format).toBe('yaml');
    expect(result.confidence).toBeLessThanOrEqual(0.7);
  });
});

// ===========================================================================
// 5. Markdown Detection
// ===========================================================================

describe('Markdown detection', () => {
  it('detects heading at start', () => {
    const input = '# My Document\n\nSome paragraph text here.';
    expectFormat(input, 'markdown', 0.85);
  });

  it('detects multiple heading levels', () => {
    const input = '## Section\n\nText\n\n### Subsection\n\nMore text';
    expectFormat(input, 'markdown', 0.75);
  });

  it('detects markdown tables', () => {
    const input = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    expectFormat(input, 'markdown', 0.8);
  });

  it('detects markdown links', () => {
    const input = 'Check out [this link](https://example.com) for more info.';
    expectFormat(input, 'markdown', 0.75);
  });

  it('detects fenced code blocks', () => {
    const input = 'Here is code:\n\n```js\nconsole.log("hello");\n```\n\nEnd.';
    expectFormat(input, 'markdown', 0.75);
  });

  it('detects bold formatting', () => {
    const input = '# Title\n\nThis is **bold** text and more content.\n\nAnother paragraph.';
    expectFormat(input, 'markdown', 0.75);
  });

  it('detects task lists', () => {
    const input = '# TODO\n\n- [ ] First task\n- [x] Second task\n- [ ] Third task';
    expectFormat(input, 'markdown', 0.75);
  });

  it('detects multiple markdown signals with higher confidence', () => {
    const input = '# Title\n\nSome **bold** text with [a link](http://example.com).\n\n```\ncode\n```';
    const result = detect(input);
    expect(result.format).toBe('markdown');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ===========================================================================
// 6. Text Detection (fallback)
// ===========================================================================

describe('Text detection', () => {
  it('detects plain prose', () => {
    const input = 'The quick brown fox jumps over the lazy dog. This is just a sentence.';
    expectFormat(input, 'text', 0.5);
  });

  it('detects code-like snippets without format markers', () => {
    const input = 'const x = 42;\nreturn x * 2;';
    const result = detect(input);
    // Code without markdown fences or JSON structure is text
    expect(result.format).toBe('text');
    expect(result.confidence).toBe(0.5);
  });

  it('detects empty string', () => {
    const result = detect('');
    expect(result.format).toBe('text');
    expect(result.confidence).toBe(0.5);
    expect(result.reason).toContain('mpty');
  });

  it('detects whitespace-only string', () => {
    const result = detect('   \n\n  \t  ');
    expect(result.format).toBe('text');
    expect(result.confidence).toBe(0.5);
  });

  it('detects single word', () => {
    const result = detect('hello');
    expect(result.format).toBe('text');
    expect(result.confidence).toBe(0.5);
  });

  it('detects random prose paragraph', () => {
    const input = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`;
    expectFormat(input, 'text', 0.5);
  });
});

// ===========================================================================
// 7. Edge Cases
// ===========================================================================

describe('Edge cases', () => {
  it('distinguishes markdown table from CSV', () => {
    // Markdown tables use | delimiters, not commas
    const input = '| Name | Age |\n| --- | --- |\n| Alice | 30 |';
    const result = detect(input);
    // Should be markdown, not CSV
    expect(result.format).toBe('markdown');
  });

  it('JSON wins over YAML for bare objects', () => {
    const input = '{"name": "Alice", "age": 30}';
    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('handles mixed signals: heading + key-value pairs', () => {
    const input = '# Config\n\nname: Alice\nage: 30\nrole: dev';
    const result = detect(input);
    // Could be markdown or yaml; should pick one with reasonable confidence
    expect(['markdown', 'yaml']).toContain(result.format);
  });

  it('handles YAML-like content that is not CSV', () => {
    const input = 'database:\n  host: localhost\n  port: 5432\n  name: mydb';
    const result = detect(input);
    expect(result.format).toBe('yaml');
  });

  it('detects JSON array of primitives', () => {
    expectFormat('[1, "two", true, null]', 'json', 0.99);
  });

  it('handles input with only newlines', () => {
    const result = detect('\n\n\n');
    expect(result.format).toBe('text');
    expect(result.confidence).toBe(0.5);
  });

  it('@ symbol alone does not trigger PAKT', () => {
    const input = '@ not a real header\nemail: user@example.com';
    const result = detect(input);
    // @ followed by non-keyword should not be PAKT
    expect(result.format).not.toBe('pakt');
  });

  it('unknown @ header does not trigger PAKT', () => {
    const input = '@unknown something\ndata here';
    const result = detect(input);
    expect(result.format).not.toBe('pakt');
  });

  it('handles JSON string value (not object/array)', () => {
    // A quoted string is valid JSON but detect expects { or [
    const result = detect('"just a string"');
    expect(result.format).toBe('text');
  });

  it('handles number as input', () => {
    const result = detect('42');
    expect(result.format).toBe('text');
  });

  it('prefers CSV over YAML for comma-delimited data', () => {
    const input = 'name,age,city\nAlice,30,Portland\nBob,25,Seattle\nCarol,35,Denver';
    const result = detect(input);
    expect(result.format).toBe('csv');
  });

  it('handles YAML with --- followed by CSV-like content', () => {
    const input = '---\ntitle: Report\nauthor: Alice\ndate: 2024-01-01';
    const result = detect(input);
    expect(result.format).toBe('yaml');
  });

  it('returns reason string for all formats', () => {
    const inputs = [
      '@from json\ndata',
      '{"a": 1}',
      'a,b,c\n1,2,3\n4,5,6',
      '# Title\n\nBody',
      'key: value\nother: thing\nmore: stuff',
      'plain text here',
    ];
    for (const input of inputs) {
      const result = detect(input);
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('confidence is always between 0 and 1', () => {
    const inputs = [
      '',
      '{}',
      '@from json',
      'a,b\n1,2\n3,4',
      '# H1',
      'k: v',
      'hello world',
      '{"broken": }',
    ];
    for (const input of inputs) {
      const result = detect(input);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });
});
