import { describe, it, expect } from 'vitest';
import { parse, PaktParseError, tokenize } from '../src/parser/index.js';
import type { Token } from '../src/parser/index.js';
import type {
  KeyValueNode,
  ObjectNode,
  TabularArrayNode,
  InlineArrayNode,
  ListArrayNode,
  CommentNode,
  DocumentNode,
} from '../src/parser/ast.js';

// ===========================================================================
// Helpers
// ===========================================================================

/** Assert that a body node is a KeyValue with the given key and string value. */
function expectKV(doc: DocumentNode, idx: number, key: string, value: unknown) {
  const node = doc.body[idx] as KeyValueNode;
  expect(node.type).toBe('keyValue');
  expect(node.key).toBe(key);
  if (typeof value === 'string') {
    expect(node.value.scalarType).toBe('string');
    expect(node.value.value).toBe(value);
  } else if (typeof value === 'number') {
    expect(node.value.scalarType).toBe('number');
    expect(node.value.value).toBe(value);
  } else if (typeof value === 'boolean') {
    expect(node.value.scalarType).toBe('boolean');
    expect(node.value.value).toBe(value);
  } else if (value === null) {
    expect(node.value.scalarType).toBe('null');
    expect(node.value.value).toBeNull();
  }
}

// ===========================================================================
// 1. Simple key-value pairs
// ===========================================================================

describe('parse: simple key-value pairs', () => {
  it('parses a single key-value string', () => {
    const doc = parse('name: Alice');
    expect(doc.type).toBe('document');
    expect(doc.body).toHaveLength(1);
    expectKV(doc, 0, 'name', 'Alice');
  });

  it('parses multiple key-value pairs', () => {
    const doc = parse('name: Alice\nrole: developer\nage: 30');
    expect(doc.body).toHaveLength(3);
    expectKV(doc, 0, 'name', 'Alice');
    expectKV(doc, 1, 'role', 'developer');
    expectKV(doc, 2, 'age', 30);
  });

  it('infers boolean values', () => {
    const doc = parse('active: true\ndeleted: false');
    expectKV(doc, 0, 'active', true);
    expectKV(doc, 1, 'deleted', false);
  });

  it('infers null values', () => {
    const doc = parse('middleName: null');
    expectKV(doc, 0, 'middleName', null);
  });

  it('infers numeric values (int, float, exponent)', () => {
    const doc = parse('count: 42\npi: 3.14\nbig: 1e10');
    expectKV(doc, 0, 'count', 42);
    expectKV(doc, 1, 'pi', 3.14);
    expectKV(doc, 2, 'big', 1e10);
  });
});

// ===========================================================================
// 2. Nested objects (2-3 levels)
// ===========================================================================

describe('parse: nested objects', () => {
  it('parses a 2-level nested object', () => {
    const input = [
      'user',
      '  name: Alice',
      '  role: developer',
    ].join('\n');

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const obj = doc.body[0] as ObjectNode;
    expect(obj.type).toBe('object');
    expect(obj.key).toBe('user');
    expect(obj.children).toHaveLength(2);
    expect((obj.children[0] as KeyValueNode).key).toBe('name');
    expect((obj.children[1] as KeyValueNode).key).toBe('role');
  });

  it('parses a 3-level nested object', () => {
    const input = [
      'config',
      '  database',
      '    host: localhost',
      '    port: 5432',
      '  cache',
      '    ttl: 300',
    ].join('\n');

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const config = doc.body[0] as ObjectNode;
    expect(config.type).toBe('object');
    expect(config.key).toBe('config');
    expect(config.children).toHaveLength(2);

    const db = config.children[0] as ObjectNode;
    expect(db.type).toBe('object');
    expect(db.key).toBe('database');
    expect(db.children).toHaveLength(2);
    expect((db.children[0] as KeyValueNode).value.value).toBe('localhost');
    expect((db.children[1] as KeyValueNode).value.value).toBe(5432);

    const cache = config.children[1] as ObjectNode;
    expect(cache.type).toBe('object');
    expect(cache.key).toBe('cache');
    expect(cache.children).toHaveLength(1);
    expect((cache.children[0] as KeyValueNode).value.value).toBe(300);
  });

  it('parses nested object with colon syntax (key:)', () => {
    const input = [
      'user:',
      '  name: Alice',
      '  age: 30',
    ].join('\n');

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const obj = doc.body[0] as ObjectNode;
    expect(obj.type).toBe('object');
    expect(obj.key).toBe('user');
    expect(obj.children).toHaveLength(2);
  });
});

// ===========================================================================
// 3. Tabular arrays
// ===========================================================================

describe('parse: tabular arrays', () => {
  it('parses a tabular array with multiple rows', () => {
    const input = [
      'users [3]{name|role|active}:',
      '  Alice|developer|true',
      '  Bob|designer|false',
      '  Charlie|manager|true',
    ].join('\n');

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const arr = doc.body[0] as TabularArrayNode;
    expect(arr.type).toBe('tabularArray');
    expect(arr.key).toBe('users');
    expect(arr.count).toBe(3);
    expect(arr.fields).toEqual(['name', 'role', 'active']);
    expect(arr.rows).toHaveLength(3);

    // Check first row values
    expect(arr.rows[0]!.values[0]!.value).toBe('Alice');
    expect(arr.rows[0]!.values[1]!.value).toBe('developer');
    expect(arr.rows[0]!.values[2]!.value).toBe(true);
  });

  it('parses tabular array with numeric fields', () => {
    const input = [
      'scores [2]{id|score}:',
      '  1|98.5',
      '  2|87.3',
    ].join('\n');

    const doc = parse(input);
    const arr = doc.body[0] as TabularArrayNode;
    expect(arr.rows[0]!.values[0]!.value).toBe(1);
    expect(arr.rows[0]!.values[1]!.value).toBe(98.5);
    expect(arr.rows[1]!.values[0]!.value).toBe(2);
  });
});

// ===========================================================================
// 4. Inline arrays
// ===========================================================================

describe('parse: inline arrays', () => {
  it('parses comma-separated inline array', () => {
    const input = 'tags [3]: React,TypeScript,Rust';

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const arr = doc.body[0] as InlineArrayNode;
    expect(arr.type).toBe('inlineArray');
    expect(arr.key).toBe('tags');
    expect(arr.count).toBe(3);
    expect(arr.values).toHaveLength(3);
    expect(arr.values[0]!.value).toBe('React');
    expect(arr.values[1]!.value).toBe('TypeScript');
    expect(arr.values[2]!.value).toBe('Rust');
  });

  it('parses inline array with numeric values', () => {
    const input = 'ids [4]: 1,2,3,4';
    const doc = parse(input);
    const arr = doc.body[0] as InlineArrayNode;
    expect(arr.values).toHaveLength(4);
    expect(arr.values[0]!.value).toBe(1);
    expect(arr.values[3]!.value).toBe(4);
  });
});

// ===========================================================================
// 5. List arrays
// ===========================================================================

describe('parse: list arrays', () => {
  it('parses list array with dash-prefixed items', () => {
    const input = [
      'events [2]:',
      '  - type: deploy',
      '    success: true',
      '  - type: rollback',
      '    success: false',
    ].join('\n');

    const doc = parse(input);
    expect(doc.body).toHaveLength(1);
    const arr = doc.body[0] as ListArrayNode;
    expect(arr.type).toBe('listArray');
    expect(arr.key).toBe('events');
    expect(arr.count).toBe(2);
    expect(arr.items).toHaveLength(2);

    const first = arr.items[0]!;
    expect(first.children).toHaveLength(2);
    expect((first.children[0] as KeyValueNode).key).toBe('type');
    expect((first.children[0] as KeyValueNode).value.value).toBe('deploy');
    expect((first.children[1] as KeyValueNode).key).toBe('success');
    expect((first.children[1] as KeyValueNode).value.value).toBe(true);
  });

  it('parses list array with single-line items', () => {
    const input = [
      'items [3]:',
      '  - name: alpha',
      '  - name: beta',
      '  - name: gamma',
    ].join('\n');

    const doc = parse(input);
    const arr = doc.body[0] as ListArrayNode;
    expect(arr.items).toHaveLength(3);
    expect((arr.items[2]!.children[0] as KeyValueNode).value.value).toBe('gamma');
  });
});

// ===========================================================================
// 6. Dictionary block
// ===========================================================================

describe('parse: dictionary block', () => {
  it('parses @dict ... @end with entries', () => {
    const input = [
      '@dict',
      '  $a: developer',
      '  $b: React',
      '@end',
      'role: $a',
    ].join('\n');

    const doc = parse(input);
    expect(doc.dictionary).not.toBeNull();
    expect(doc.dictionary!.type).toBe('dictBlock');
    expect(doc.dictionary!.entries).toHaveLength(2);
    expect(doc.dictionary!.entries[0]!.alias).toBe('$a');
    expect(doc.dictionary!.entries[0]!.expansion).toBe('developer');
    expect(doc.dictionary!.entries[1]!.alias).toBe('$b');
    expect(doc.dictionary!.entries[1]!.expansion).toBe('React');

    // Body after dictionary
    expect(doc.body).toHaveLength(1);
    expectKV(doc, 0, 'role', '$a');
  });

  it('parses empty dictionary block', () => {
    const input = '@dict\n@end\nname: Alice';
    const doc = parse(input);
    expect(doc.dictionary).not.toBeNull();
    expect(doc.dictionary!.entries).toHaveLength(0);
  });
});

// ===========================================================================
// 7. Headers
// ===========================================================================

describe('parse: headers', () => {
  it('parses @from header', () => {
    const doc = parse('@from json\nname: Alice');
    expect(doc.headers).toHaveLength(1);
    expect(doc.headers[0]!.headerType).toBe('from');
    expect(doc.headers[0]!.value).toBe('json');
  });

  it('parses @target header', () => {
    const doc = parse('@target gpt-4o\nname: Alice');
    expect(doc.headers).toHaveLength(1);
    expect(doc.headers[0]!.headerType).toBe('target');
    expect(doc.headers[0]!.value).toBe('gpt-4o');
  });

  it('parses @version header', () => {
    const doc = parse('@version 0.1.0\nname: Alice');
    expect(doc.headers).toHaveLength(1);
    expect(doc.headers[0]!.headerType).toBe('version');
    expect(doc.headers[0]!.value).toBe('0.1.0');
  });

  it('parses multiple headers', () => {
    const input = '@from json\n@target gpt-4o\n@version 0.1.0\nname: Alice';
    const doc = parse(input);
    expect(doc.headers).toHaveLength(3);
    expect(doc.headers[0]!.headerType).toBe('from');
    expect(doc.headers[1]!.headerType).toBe('target');
    expect(doc.headers[2]!.headerType).toBe('version');
  });

  it('parses @compress and @warning headers', () => {
    const input = '@compress semantic\n@warning lossy\ndata: test';
    const doc = parse(input);
    expect(doc.headers).toHaveLength(2);
    expect(doc.headers[0]!.headerType).toBe('compress');
    expect(doc.headers[0]!.value).toBe('semantic');
    expect(doc.headers[1]!.headerType).toBe('warning');
    expect(doc.headers[1]!.value).toBe('lossy');
  });
});

// ===========================================================================
// 8. Comments
// ===========================================================================

describe('parse: comments', () => {
  it('parses full-line comments', () => {
    const input = '% This is a comment\nname: Alice';
    const doc = parse(input);
    expect(doc.body).toHaveLength(2);
    const comment = doc.body[0] as CommentNode;
    expect(comment.type).toBe('comment');
    expect(comment.text).toBe('This is a comment');
  });

  it('handles inline comments (tokenizer captures them)', () => {
    // Inline comments are consumed by the tokenizer as separate tokens
    // The parser may or may not include them in the AST depending on context
    const tokens = tokenize('name: Alice % inline comment');
    const commentTokens = tokens.filter((t: Token) => t.type === 'COMMENT');
    expect(commentTokens).toHaveLength(1);
    expect(commentTokens[0]!.value).toBe('inline comment');
  });

  it('parses multiple comments', () => {
    const input = '% first comment\n% second comment\nname: Alice';
    const doc = parse(input);
    const comments = doc.body.filter(n => n.type === 'comment');
    expect(comments).toHaveLength(2);
  });
});

// ===========================================================================
// 9. Quoted strings with escapes
// ===========================================================================

describe('parse: quoted strings', () => {
  it('tokenizes a quoted string with escapes', () => {
    const tokens = tokenize('name: "hello \\"world\\"\\n"');
    const qTok = tokens.find((t: Token) => t.type === 'QUOTED_STRING');
    expect(qTok).toBeDefined();
    expect(qTok!.value).toBe('hello "world"\n');
  });

  it('tokenizes a quoted string with tab escape', () => {
    const tokens = tokenize('val: "col1\\tcol2"');
    const qTok = tokens.find((t: Token) => t.type === 'QUOTED_STRING');
    expect(qTok!.value).toBe('col1\tcol2');
  });

  it('tokenizes a quoted string with backslash escape', () => {
    const tokens = tokenize('path: "C:\\\\Users\\\\name"');
    const qTok = tokens.find((t: Token) => t.type === 'QUOTED_STRING');
    expect(qTok!.value).toBe('C:\\Users\\name');
  });
});

// ===========================================================================
// 10. Error: tab indentation
// ===========================================================================

describe('error: tab indentation', () => {
  it('rejects tab characters with a clear error', () => {
    expect(() => tokenize('\tname: Alice')).toThrow(/[Tt]ab/);
  });

  it('reports line and column for tab error', () => {
    try {
      tokenize('good: line\n\tbad: line');
      expect.fail('Should have thrown');
    } catch (e) {
      const err = e as { line: number; column: number };
      expect(err.line).toBe(2);
      expect(err.column).toBe(1);
    }
  });
});

// ===========================================================================
// 11. Error: inconsistent indent
// ===========================================================================

describe('error: inconsistent indent', () => {
  it('reports error on unexpected extra indentation in strict mode', () => {
    // Children at indent 2 then a sudden jump to indent 6 within same block
    const input = [
      'user',
      '  name: Alice',
      '      age: 30', // 6 spaces — should be 2 (same level as name)
    ].join('\n');

    // In strict mode this should throw due to unexpected deeper indent
    expect(() => parse(input, 'strict')).toThrow();
  });

  it('continues in lenient mode on unexpected indentation', () => {
    const input = [
      'user',
      '  name: Alice',
      '      age: 30', // unexpected 6-space indent
    ].join('\n');

    const doc = parse(input, 'lenient');
    expect(doc.type).toBe('document');
    // Should have collected errors
    const errors = (doc as DocumentNode & { errors?: PaktParseError[] }).errors;
    expect(errors).toBeDefined();
    expect(errors!.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 12. Error: undefined alias reference (lenient mode warning)
// ===========================================================================

describe('error: alias handling', () => {
  it('parses alias references as plain string values', () => {
    // Without expansion, $xyz should remain as a string
    const input = '@dict\n  $a: developer\n@end\nrole: $xyz';
    const doc = parse(input, 'lenient');
    expect(doc.body).toHaveLength(1);
    const kv = doc.body[0] as KeyValueNode;
    expect(kv.value.value).toBe('$xyz');
  });

  it('stores alias definitions in dictionary block', () => {
    const input = '@dict\n  $a: hello\n  $b: world\n@end\nval: test';
    const doc = parse(input);
    expect(doc.dictionary).not.toBeNull();
    expect(doc.dictionary!.entries).toHaveLength(2);
    expect(doc.dictionary!.entries[0]!.alias).toBe('$a');
    expect(doc.dictionary!.entries[1]!.alias).toBe('$b');
  });
});

// ===========================================================================
// 13. Roundtrip: parse known PAKT strings, verify AST structure
// ===========================================================================

describe('roundtrip: full PAKT documents', () => {
  it('parses a complete PAKT document', () => {
    const input = [
      '@from json',
      '@version 0.1.0',
      '@dict',
      '  $a: developer',
      '@end',
      'name: Sriinnu',
      'role: $a',
      'age: 28',
      'active: true',
      'projects [2]{id|name|status}:',
      '  1|VAAYU|active',
      '  2|ClipForge|planning',
      'tags [3]: React,TypeScript,Rust',
    ].join('\n');

    const doc = parse(input);

    // Headers
    expect(doc.headers).toHaveLength(2);
    expect(doc.headers[0]!.headerType).toBe('from');
    expect(doc.headers[1]!.headerType).toBe('version');

    // Dictionary
    expect(doc.dictionary).not.toBeNull();
    expect(doc.dictionary!.entries).toHaveLength(1);
    expect(doc.dictionary!.entries[0]!.alias).toBe('$a');

    // Body: 6 nodes
    expect(doc.body).toHaveLength(6);

    // Simple KVs
    expectKV(doc, 0, 'name', 'Sriinnu');
    expectKV(doc, 1, 'role', '$a');
    expectKV(doc, 2, 'age', 28);
    expectKV(doc, 3, 'active', true);

    // Tabular array
    const tabular = doc.body[4] as TabularArrayNode;
    expect(tabular.type).toBe('tabularArray');
    expect(tabular.key).toBe('projects');
    expect(tabular.count).toBe(2);
    expect(tabular.fields).toEqual(['id', 'name', 'status']);
    expect(tabular.rows).toHaveLength(2);

    // Inline array
    const inline = doc.body[5] as InlineArrayNode;
    expect(inline.type).toBe('inlineArray');
    expect(inline.key).toBe('tags');
    expect(inline.count).toBe(3);
    expect(inline.values).toHaveLength(3);
  });

  it('parses a document with nested objects and comments', () => {
    const input = [
      '@from yaml',
      '% Configuration file',
      'server',
      '  host: localhost',
      '  port: 8080',
      '  ssl: false',
      'logging',
      '  level: info',
      '  % Log rotation settings',
      '  rotation',
      '    maxSize: 100',
      '    maxFiles: 5',
    ].join('\n');

    const doc = parse(input);

    expect(doc.headers).toHaveLength(1);
    expect(doc.headers[0]!.value).toBe('yaml');

    // Comment + server + logging = 3 body nodes
    expect(doc.body).toHaveLength(3);

    const comment = doc.body[0] as CommentNode;
    expect(comment.type).toBe('comment');
    expect(comment.text).toBe('Configuration file');

    const server = doc.body[1] as ObjectNode;
    expect(server.type).toBe('object');
    expect(server.key).toBe('server');
    expect(server.children).toHaveLength(3);

    const logging = doc.body[2] as ObjectNode;
    expect(logging.type).toBe('object');
    expect(logging.key).toBe('logging');
    // level, comment, rotation = 3 children
    expect(logging.children).toHaveLength(3);

    const rotation = logging.children[2] as ObjectNode;
    expect(rotation.type).toBe('object');
    expect(rotation.key).toBe('rotation');
    expect(rotation.children).toHaveLength(2);
  });

  it('preserves source positions on all nodes', () => {
    const doc = parse('@from json\nname: Alice');
    expect(doc.position.line).toBe(1);
    expect(doc.position.column).toBe(1);

    const kv = doc.body[0] as KeyValueNode;
    expect(kv.position.line).toBe(2);
  });

  it('handles CRLF line endings', () => {
    const input = '@from json\r\nname: Alice\r\nage: 30';
    const doc = parse(input);
    expect(doc.headers).toHaveLength(1);
    expect(doc.body).toHaveLength(2);
    expectKV(doc, 0, 'name', 'Alice');
    expectKV(doc, 1, 'age', 30);
  });

  it('handles empty input', () => {
    const doc = parse('');
    expect(doc.type).toBe('document');
    expect(doc.headers).toHaveLength(0);
    expect(doc.dictionary).toBeNull();
    expect(doc.body).toHaveLength(0);
  });
});

// ===========================================================================
// Tokenizer-specific tests
// ===========================================================================

describe('tokenize: basics', () => {
  it('produces INDENT tokens with correct space count', () => {
    const tokens = tokenize('  name: Alice');
    const indent = tokens.find((t: Token) => t.type === 'INDENT');
    expect(indent).toBeDefined();
    expect(indent!.value).toBe('2');
  });

  it('produces KEY and VALUE tokens for key: value', () => {
    const tokens = tokenize('name: Alice');
    const key = tokens.find((t: Token) => t.type === 'KEY');
    const value = tokens.find((t: Token) => t.type === 'VALUE');
    expect(key).toBeDefined();
    expect(key!.value).toBe('name');
    expect(value).toBeDefined();
    expect(value!.value).toBe('Alice');
  });

  it('produces HEADER token for @from', () => {
    const tokens = tokenize('@from json');
    const header = tokens.find((t: Token) => t.type === 'HEADER');
    expect(header).toBeDefined();
    expect(header!.value).toBe('@from json');
  });

  it('produces DICT_START and DICT_END tokens', () => {
    const tokens = tokenize('@dict\n@end');
    const start = tokens.find((t: Token) => t.type === 'DICT_START');
    const end = tokens.find((t: Token) => t.type === 'DICT_END');
    expect(start).toBeDefined();
    expect(end).toBeDefined();
  });

  it('produces EOF at end', () => {
    const tokens = tokenize('name: Alice');
    const last = tokens[tokens.length - 1];
    expect(last!.type).toBe('EOF');
  });

  it('produces NUMBER token for bare numbers', () => {
    const tokens = tokenize('42');
    const num = tokens.find((t: Token) => t.type === 'NUMBER');
    expect(num).toBeDefined();
    expect(num!.value).toBe('42');
  });

  it('produces PIPE, BRACKET, BRACE tokens', () => {
    const tokens = tokenize('a [3]{x|y}:');
    const types = tokens.map((t: Token) => t.type);
    expect(types).toContain('BRACKET_OPEN');
    expect(types).toContain('BRACKET_CLOSE');
    expect(types).toContain('BRACE_OPEN');
    expect(types).toContain('BRACE_CLOSE');
    expect(types).toContain('PIPE');
  });

  it('produces DASH token for list items', () => {
    const tokens = tokenize('  - name: Alice');
    const dash = tokens.find((t: Token) => t.type === 'DASH');
    expect(dash).toBeDefined();
    expect(dash!.value).toBe('-');
  });
});
