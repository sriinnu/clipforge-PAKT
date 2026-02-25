import { describe, expect, it } from 'vitest';
import type {
  BodyNode,
  CommentNode,
  DictBlockNode,
  DocumentNode,
  HeaderNode,
  InlineArrayNode,
  KeyValueNode,
  ListArrayNode,
  ListItemNode,
  ObjectNode,
  ScalarNode,
  TabularArrayNode,
  TabularRowNode,
} from '../src/parser/ast.js';
import { createPosition, inferScalar } from '../src/parser/ast.js';
import { serialize } from '../src/serializer/serialize.js';

// -- Helpers ---------------------------------------------------------------

const p = createPosition(1, 1, 0);
const s = (v: string, q = false): ScalarNode => ({
  type: 'scalar',
  scalarType: 'string',
  value: v,
  quoted: q,
  position: p,
});
const n = (v: number, r?: string): ScalarNode => ({
  type: 'scalar',
  scalarType: 'number',
  value: v,
  raw: r ?? String(v),
  position: p,
});
const b = (v: boolean): ScalarNode => ({
  type: 'scalar',
  scalarType: 'boolean',
  value: v,
  position: p,
});
const nil = (): ScalarNode => ({ type: 'scalar', scalarType: 'null', value: null, position: p });
const kv = (key: string, val: ScalarNode): KeyValueNode => ({
  type: 'keyValue',
  key,
  value: val,
  position: p,
});
const obj = (key: string, children: BodyNode[]): ObjectNode => ({
  type: 'object',
  key,
  children,
  position: p,
});
const cmt = (text: string): CommentNode => ({ type: 'comment', text, inline: false, position: p });
const row = (vals: ScalarNode[]): TabularRowNode => ({
  type: 'tabularRow',
  values: vals,
  position: p,
});
const item = (children: BodyNode[]): ListItemNode => ({ type: 'listItem', children, position: p });
const hdr = (ht: HeaderNode['headerType'], v: string): HeaderNode =>
  ({ type: 'header', headerType: ht, value: v, position: p }) as HeaderNode;
const dict = (entries: Array<[string, string]>): DictBlockNode => ({
  type: 'dictBlock',
  entries: entries.map(([a, e]) => ({
    type: 'dictEntry' as const,
    alias: a,
    expansion: e,
    position: p,
  })),
  position: p,
});
const doc = (
  body: BodyNode[],
  headers: HeaderNode[] = [],
  d: DictBlockNode | null = null,
): DocumentNode => ({ type: 'document', headers, dictionary: d, body, position: p });

// -- Tests -----------------------------------------------------------------

describe('serialize', () => {
  describe('key-value pairs', () => {
    it('should serialize string, number, boolean, null', () => {
      const ast = doc([
        kv('name', s('Sriinnu')),
        kv('age', n(28)),
        kv('on', b(true)),
        kv('x', nil()),
      ]);
      expect(serialize(ast)).toBe('name: Sriinnu\nage: 28\non: true\nx: null\n');
    });

    it('should serialize multiple key-value pairs', () => {
      const ast = doc([kv('a', s('Alice')), kv('b', n(30)), kv('c', b(false))]);
      expect(serialize(ast)).toBe('a: Alice\nb: 30\nc: false\n');
    });
  });

  describe('nested objects', () => {
    it('should serialize a single-level nested object', () => {
      const ast = doc([obj('user', [kv('name', s('Sriinnu')), kv('role', s('developer'))])]);
      expect(serialize(ast)).toBe('user\n  name: Sriinnu\n  role: developer\n');
    });

    it('should serialize a deeply nested object (3 levels)', () => {
      const ast = doc([
        obj('config', [
          obj('db', [obj('primary', [kv('host', s('localhost')), kv('port', n(5432))])]),
        ]),
      ]);
      expect(serialize(ast)).toBe(
        'config\n  db\n    primary\n      host: localhost\n      port: 5432\n',
      );
    });

    it('should serialize siblings at the same nesting level', () => {
      const ast = doc([
        obj('server', [kv('host', s('0.0.0.0')), kv('port', n(8080))]),
        obj('client', [kv('timeout', n(3000))]),
      ]);
      expect(serialize(ast)).toBe(
        'server\n  host: 0.0.0.0\n  port: 8080\nclient\n  timeout: 3000\n',
      );
    });
  });

  describe('tabular arrays', () => {
    it('should serialize a tabular array with rows', () => {
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'projects',
        count: 3,
        fields: ['id', 'name', 'status'],
        position: p,
        rows: [
          row([n(1), s('VAAYU'), s('active')]),
          row([n(2), s('ClipForge'), s('planning')]),
          row([n(3), s('Substack'), s('active')]),
        ],
      };
      expect(serialize(doc([tab]))).toBe(
        'projects [3]{id|name|status}:\n  1|VAAYU|active\n  2|ClipForge|planning\n  3|Substack|active\n',
      );
    });

    it('should quote tabular cell values containing pipes', () => {
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'data',
        count: 1,
        fields: ['id', 'val'],
        position: p,
        rows: [row([n(1), s('x|y|z')])],
      };
      expect(serialize(doc([tab]))).toBe('data [1]{id|val}:\n  1|"x|y|z"\n');
    });
  });

  describe('inline arrays', () => {
    it('should serialize an inline array of strings', () => {
      const arr: InlineArrayNode = {
        type: 'inlineArray',
        key: 'tags',
        count: 3,
        position: p,
        values: [s('React'), s('TypeScript'), s('Rust')],
      };
      expect(serialize(doc([arr]))).toBe('tags [3]: React,TypeScript,Rust\n');
    });

    it('should serialize an inline array of numbers', () => {
      const arr: InlineArrayNode = {
        type: 'inlineArray',
        key: 'scores',
        count: 4,
        position: p,
        values: [n(10), n(20), n(30), n(40)],
      };
      expect(serialize(doc([arr]))).toBe('scores [4]: 10,20,30,40\n');
    });
  });

  describe('list arrays', () => {
    it('should serialize a list array with items', () => {
      const list: ListArrayNode = {
        type: 'listArray',
        key: 'events',
        count: 2,
        position: p,
        items: [
          item([kv('type', s('deploy')), kv('success', b(true))]),
          item([kv('type', s('alert')), kv('message', s('CPU spike'))]),
        ],
      };
      expect(serialize(doc([list]))).toBe(
        'events [2]:\n  - type: deploy\n    success: true\n  - type: alert\n    message: CPU spike\n',
      );
    });

    it('should serialize a single-property list item', () => {
      const list: ListArrayNode = {
        type: 'listArray',
        key: 'links',
        count: 1,
        position: p,
        items: [item([kv('url', s('https://example.com'))])],
      };
      expect(serialize(doc([list]))).toBe('links [1]:\n  - url: "https://example.com"\n');
    });
  });

  describe('dictionary block', () => {
    it('should serialize a dictionary block', () => {
      const ast = doc(
        [kv('dept', s('Engineering'))],
        [],
        dict([
          ['$a', 'Engineering'],
          ['$b', 'in-progress'],
        ]),
      );
      expect(serialize(ast)).toBe(
        '@dict\n  $a: Engineering\n  $b: in-progress\n@end\n\ndept: Engineering\n',
      );
    });

    it('should skip empty dictionary', () => {
      const ast = doc([kv('x', n(1))], [], dict([]));
      expect(serialize(ast)).toBe('x: 1\n');
    });
  });

  describe('headers', () => {
    it('should serialize @version header', () => {
      expect(serialize(doc([kv('x', n(1))], [hdr('version', '1.0.0')]))).toBe(
        '@version 1.0.0\n\nx: 1\n',
      );
    });

    it('should serialize @from and @target headers', () => {
      expect(serialize(doc([kv('x', n(1))], [hdr('from', 'json'), hdr('target', 'claude')]))).toBe(
        '@from json\n@target claude\n\nx: 1\n',
      );
    });

    it('should emit headers in canonical order regardless of input order', () => {
      const out = serialize(
        doc(
          [kv('x', n(1))],
          [hdr('target', 'gpt-4o'), hdr('version', '0.1.0'), hdr('from', 'yaml')],
        ),
      );
      const lines = out.split('\n');
      expect(lines[0]).toBe('@version 0.1.0');
      expect(lines[1]).toBe('@from yaml');
      expect(lines[2]).toBe('@target gpt-4o');
    });

    it('should serialize @compress and @warning after dict', () => {
      const ast = doc(
        [kv('x', n(1))],
        [hdr('version', '1.0.0'), hdr('compress', 'semantic'), hdr('warning', 'lossy')],
        dict([['$a', 'test']]),
      );
      const lines = serialize(ast).split('\n');
      expect(lines[0]).toBe('@version 1.0.0');
      expect(lines[1]).toBe('@dict');
      expect(lines[2]).toBe('  $a: test');
      expect(lines[3]).toBe('@end');
      expect(lines[4]).toBe('@compress semantic');
      expect(lines[5]).toBe('@warning lossy');
    });
  });

  describe('quoting', () => {
    it('should quote values containing colons', () => {
      expect(serialize(doc([kv('e', s('Error: failed'))]))).toBe('e: "Error: failed"\n');
    });
    it('should quote values containing pipes', () => {
      expect(serialize(doc([kv('d', s('x|y|z'))]))).toBe('d: "x|y|z"\n');
    });
    it('should quote values starting with $', () => {
      expect(serialize(doc([kv('p', s('$100'))]))).toBe('p: "$100"\n');
    });
    it('should quote values starting with %', () => {
      expect(serialize(doc([kv('n', s('%not a comment'))]))).toBe('n: "%not a comment"\n');
    });
    it('should quote values with leading whitespace', () => {
      expect(serialize(doc([kv('w', s('  hello'))]))).toBe('w: "  hello"\n');
    });
    it('should quote values with trailing whitespace', () => {
      expect(serialize(doc([kv('w', s('hello  '))]))).toBe('w: "hello  "\n');
    });
    it('should quote empty string values', () => {
      expect(serialize(doc([kv('e', s(''))]))).toBe('e: ""\n');
    });
    it('should preserve quoted flag from source', () => {
      expect(serialize(doc([kv('v', s('plain', true))]))).toBe('v: "plain"\n');
    });
  });

  describe('escape sequences', () => {
    it('should escape double quotes inside values', () => {
      expect(serialize(doc([kv('m', s('say "hi"'))]))).toBe('m: "say \\"hi\\""\n');
    });
    it('should escape backslashes inside values', () => {
      expect(serialize(doc([kv('p', s('C:\\Users\\dev'))]))).toBe('p: "C:\\\\Users\\\\dev"\n');
    });
    it('should escape newlines inside values', () => {
      expect(serialize(doc([kv('m', s('line1\nline2'))]))).toBe('m: "line1\\nline2"\n');
    });
    it('should handle combined escapes', () => {
      expect(serialize(doc([kv('c', s('a"b\\c\nd'))]))).toBe('c: "a\\"b\\\\c\\nd"\n');
    });
  });

  describe('empty document', () => {
    it('should serialize an empty document', () => {
      expect(serialize(doc([]))).toBe('');
    });
    it('should serialize a document with only headers', () => {
      expect(serialize(doc([], [hdr('version', '1.0.0')]))).toBe('@version 1.0.0\n\n');
    });
  });

  describe('comments', () => {
    it('should serialize a standalone comment', () => {
      expect(serialize(doc([cmt('this is a comment')]))).toBe('% this is a comment\n');
    });
    it('should serialize comments among body nodes', () => {
      expect(serialize(doc([cmt('user section'), kv('name', s('Alice')), cmt('end')]))).toBe(
        '% user section\nname: Alice\n% end\n',
      );
    });
    it('should serialize indented comments inside objects', () => {
      expect(
        serialize(doc([obj('config', [cmt('database settings'), kv('host', s('localhost'))])])),
      ).toBe('config\n  % database settings\n  host: localhost\n');
    });
  });

  describe('full document round-trip', () => {
    it('should serialize a complete PAKT document', () => {
      const headers = [hdr('version', '1.0.0'), hdr('from', 'json'), hdr('target', 'claude')];
      const d = dict([
        ['$a', 'Engineering'],
        ['$b', 'in-progress'],
      ]);
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'projects',
        count: 2,
        fields: ['id', 'name', 'status'],
        position: p,
        rows: [row([n(1), s('VAAYU'), s('active')]), row([n(2), s('ClipForge'), s('planning')])],
      };
      const tags: InlineArrayNode = {
        type: 'inlineArray',
        key: 'tags',
        count: 3,
        position: p,
        values: [s('React'), s('TypeScript'), s('Rust')],
      };
      const events: ListArrayNode = {
        type: 'listArray',
        key: 'events',
        count: 1,
        position: p,
        items: [item([kv('type', s('deploy')), kv('success', b(true))])],
      };
      const body: BodyNode[] = [
        cmt('project overview'),
        kv('org', s('YugenLab')),
        obj('meta', [kv('version', s('2.0')), kv('active', b(true))]),
        tab,
        tags,
        events,
      ];
      expect(serialize(doc(body, headers, d))).toBe(
        '@version 1.0.0\n@from json\n@target claude\n' +
          '@dict\n  $a: Engineering\n  $b: in-progress\n@end\n\n' +
          '% project overview\norg: YugenLab\nmeta\n  version: 2.0\n  active: true\n' +
          'projects [2]{id|name|status}:\n  1|VAAYU|active\n  2|ClipForge|planning\n' +
          'tags [3]: React,TypeScript,Rust\n' +
          'events [1]:\n  - type: deploy\n    success: true\n',
      );
    });

    it('should use inferScalar for round-trip compatibility', () => {
      const pos = createPosition(1, 1, 0);
      const ast = doc([
        kv('n', inferScalar('42', pos)),
        kv('b', inferScalar('true', pos)),
        kv('nl', inferScalar('null', pos)),
        kv('s', inferScalar('hello', pos)),
      ]);
      expect(serialize(ast)).toBe('n: 42\nb: true\nnl: null\ns: hello\n');
    });

    it('should handle number with scientific notation raw value', () => {
      expect(serialize(doc([kv('big', n(1000, '1.0e3'))]))).toBe('big: 1.0e3\n');
    });
  });
});
