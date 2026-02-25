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
import { createPosition } from '../src/parser/ast.js';
import { parse } from '../src/parser/parser.js';
import { prettyPrint } from '../src/serializer/pretty.js';
import { serialize } from '../src/serializer/serialize.js';

// -- Helpers (same factory pattern as serializer.test.ts) --------------------

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
  position: p,
  entries: entries.map(([a, e]) => ({
    type: 'dictEntry' as const,
    alias: a,
    expansion: e,
    position: p,
  })),
});
const doc = (
  body: BodyNode[],
  headers: HeaderNode[] = [],
  d: DictBlockNode | null = null,
): DocumentNode => ({ type: 'document', headers, dictionary: d, body, position: p });

// -- Tests -------------------------------------------------------------------

describe('prettyPrint', () => {
  describe('basic key-value pairs', () => {
    it('should pretty-print string, number, boolean, null', () => {
      const ast = doc([
        kv('name', s('Alice')),
        kv('age', n(28)),
        kv('on', b(true)),
        kv('x', nil()),
      ]);
      const output = prettyPrint(ast);
      expect(output).toContain('name: Alice');
      expect(output).toContain('age: 28');
      expect(output).toContain('on: true');
      expect(output).toContain('x: null');
    });

    it('should add section spacing between top-level key-value pairs', () => {
      const ast = doc([kv('a', s('one')), kv('b', s('two'))]);
      const lines = prettyPrint(ast).split('\n');
      // With sectionSpacing=1, there should be a blank line between the two
      expect(lines[0]).toBe('a: one');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('b: two');
    });
  });

  describe('column alignment in tabular arrays', () => {
    it('should align columns with space-padded pipes', () => {
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'users',
        count: 3,
        fields: ['name', 'role', 'city'],
        position: p,
        rows: [
          row([s('Alice'), s('developer'), s('New York')]),
          row([s('Bob'), s('designer'), s('London')]),
          row([s('Carol'), s('manager'), s('Tokyo')]),
        ],
      };
      const output = prettyPrint(doc([tab]));
      const lines = output.trim().split('\n');
      // Header line
      expect(lines[0]).toBe('users [3]{name|role|city}:');
      // All pipe characters in rows should be vertically aligned
      const pipePositions = lines.slice(1).map((line) => {
        const positions: number[] = [];
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '|') positions.push(i);
        }
        return positions;
      });
      // Pipe positions must be the same across all rows
      expect(pipePositions[0]).toEqual(pipePositions[1]);
      expect(pipePositions[1]).toEqual(pipePositions[2]);
    });

    it('should disable alignment when alignColumns is false', () => {
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'data',
        count: 2,
        fields: ['id', 'name'],
        position: p,
        rows: [row([n(1), s('Alice')]), row([n(2), s('Bob')])],
      };
      const output = prettyPrint(doc([tab]), { alignColumns: false });
      // Without alignment, rows use compact pipe-delimited format
      expect(output).toContain('1|Alice');
      expect(output).toContain('2|Bob');
    });
  });

  describe('section spacing', () => {
    it('should add configurable blank lines between top-level nodes', () => {
      const ast = doc([kv('a', n(1)), kv('b', n(2))]);
      const output2 = prettyPrint(ast, { sectionSpacing: 2 });
      const lines = output2.split('\n');
      // a: 1 \n \n \n b: 2 \n (2 blank lines = sectionSpacing 2)
      expect(lines[0]).toBe('a: 1');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('');
      expect(lines[3]).toBe('b: 2');
    });

    it('should not add spacing with sectionSpacing 0', () => {
      const ast = doc([kv('a', n(1)), kv('b', n(2))]);
      const output = prettyPrint(ast, { sectionSpacing: 0 });
      expect(output).toBe('a: 1\nb: 2\n');
    });

    it('should keep adjacent comments tight', () => {
      const ast = doc([cmt('first'), cmt('second'), kv('x', n(1))]);
      const output = prettyPrint(ast);
      const lines = output.trim().split('\n');
      // Comments should not have blank line between them
      expect(lines[0]).toBe('% first');
      expect(lines[1]).toBe('% second');
      // But there should be a blank between the comment block and the KV
      expect(lines[2]).toBe('');
      expect(lines[3]).toBe('x: 1');
    });
  });

  describe('custom options', () => {
    it('should respect custom indent width', () => {
      const ast = doc([obj('user', [kv('name', s('Alice'))])]);
      const output = prettyPrint(ast, { indent: 4 });
      const lines = output.trim().split('\n');
      expect(lines[0]).toBe('user');
      expect(lines[1]).toBe('    name: Alice');
    });

    it('should use default indent of 2', () => {
      const ast = doc([obj('user', [kv('name', s('Alice'))])]);
      const output = prettyPrint(ast);
      const lines = output.trim().split('\n');
      expect(lines[1]).toBe('  name: Alice');
    });
  });

  describe('nested object indentation', () => {
    it('should indent nested objects correctly', () => {
      const ast = doc([
        obj('config', [obj('db', [kv('host', s('localhost')), kv('port', n(5432))])]),
      ]);
      const output = prettyPrint(ast);
      const lines = output.trim().split('\n');
      expect(lines[0]).toBe('config');
      expect(lines[1]).toBe('  db');
      expect(lines[2]).toBe('    host: localhost');
      expect(lines[3]).toBe('    port: 5432');
    });

    it('should handle multiple sibling objects at same depth', () => {
      const ast = doc([
        obj('server', [kv('host', s('0.0.0.0'))]),
        obj('client', [kv('timeout', n(3000))]),
      ]);
      const output = prettyPrint(ast);
      // Should have a blank line between siblings (section spacing)
      expect(output).toContain('server\n  host: 0.0.0.0\n\nclient\n  timeout: 3000');
    });
  });

  describe('list arrays with dash items', () => {
    it('should serialize list array items with dash prefix', () => {
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
      const output = prettyPrint(doc([list]));
      expect(output).toContain('events [2]:');
      expect(output).toContain('  - type: deploy');
      expect(output).toContain('    success: true');
      expect(output).toContain('  - type: alert');
      expect(output).toContain('    message: CPU spike');
    });
  });

  describe('inline arrays', () => {
    it('should serialize inline arrays as comma-separated values', () => {
      const arr: InlineArrayNode = {
        type: 'inlineArray',
        key: 'tags',
        count: 3,
        position: p,
        values: [s('React'), s('TypeScript'), s('Rust')],
      };
      const output = prettyPrint(doc([arr]));
      expect(output).toContain('tags [3]: React,TypeScript,Rust');
    });
  });

  describe('comment nodes', () => {
    it('should emit standalone comments', () => {
      const output = prettyPrint(doc([cmt('this is a comment')]));
      expect(output).toBe('% this is a comment\n');
    });

    it('should emit indented comments inside objects', () => {
      const ast = doc([obj('cfg', [cmt('db settings'), kv('host', s('localhost'))])]);
      const output = prettyPrint(ast);
      expect(output).toContain('  % db settings');
      expect(output).toContain('  host: localhost');
    });
  });

  describe('dictionary block formatting', () => {
    it('should format @dict...@end block', () => {
      const ast = doc(
        [kv('dept', s('Engineering'))],
        [],
        dict([
          ['$a', 'Engineering'],
          ['$b', 'in-progress'],
        ]),
      );
      const output = prettyPrint(ast);
      expect(output).toContain('@dict');
      expect(output).toContain('  $a: Engineering');
      expect(output).toContain('  $b: in-progress');
      expect(output).toContain('@end');
    });

    it('should skip empty dictionary', () => {
      const ast = doc([kv('x', n(1))], [], dict([]));
      const output = prettyPrint(ast);
      expect(output).not.toContain('@dict');
    });
  });

  describe('headers', () => {
    it('should emit headers in canonical order', () => {
      const ast = doc(
        [kv('x', n(1))],
        [hdr('target', 'gpt-4o'), hdr('version', '0.1.0'), hdr('from', 'yaml')],
      );
      const output = prettyPrint(ast);
      const lines = output.split('\n');
      expect(lines[0]).toBe('@version 0.1.0');
      expect(lines[1]).toBe('@from yaml');
      expect(lines[2]).toBe('@target gpt-4o');
    });

    it('should emit @compress and @warning after dict block', () => {
      const ast = doc(
        [kv('x', n(1))],
        [hdr('version', '1.0.0'), hdr('compress', 'semantic'), hdr('warning', 'lossy')],
        dict([['$a', 'test']]),
      );
      const output = prettyPrint(ast);
      const lines = output.split('\n');
      expect(lines[0]).toBe('@version 1.0.0');
      expect(lines[1]).toBe('@dict');
      expect(lines[2]).toBe('  $a: test');
      expect(lines[3]).toBe('@end');
      expect(lines[4]).toBe('@compress semantic');
      expect(lines[5]).toBe('@warning lossy');
    });
  });

  describe('quoting', () => {
    it('should quote values that need quoting', () => {
      const output = prettyPrint(doc([kv('e', s('Error: failed'))]));
      expect(output).toContain('"Error: failed"');
    });

    it('should quote empty strings', () => {
      const output = prettyPrint(doc([kv('e', s(''))]));
      expect(output).toContain('""');
    });
  });

  describe('round-trip: prettyPrint output is parseable', () => {
    it('should round-trip a simple document through parse', () => {
      const ast = doc([kv('name', s('Alice')), kv('age', n(28))], [], null);
      // prettyPrint with no section spacing to ensure clean parse
      const pretty = prettyPrint(ast, { sectionSpacing: 0 });
      const reparsed = parse(pretty);
      expect(reparsed.body).toHaveLength(2);
      expect((reparsed.body[0] as KeyValueNode).key).toBe('name');
      expect((reparsed.body[1] as KeyValueNode).key).toBe('age');
    });

    it('should round-trip a tabular array with alignment', () => {
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'users',
        count: 2,
        fields: ['name', 'role'],
        position: p,
        rows: [row([s('Alice'), s('developer')]), row([s('Bob'), s('designer')])],
      };
      const pretty = prettyPrint(doc([tab]), { sectionSpacing: 0 });
      const reparsed = parse(pretty);
      const arr = reparsed.body[0] as TabularArrayNode;
      expect(arr.type).toBe('tabularArray');
      expect(arr.fields).toEqual(['name', 'role']);
      expect(arr.rows).toHaveLength(2);
      expect(arr.rows[0]?.values[0]?.value).toBe('Alice');
      expect(arr.rows[1]?.values[0]?.value).toBe('Bob');
    });

    it('should round-trip a full document with headers, dict, and body', () => {
      const headers = [hdr('version', '1.0.0'), hdr('from', 'json')];
      const d = dict([['$a', 'Engineering']]);
      const tab: TabularArrayNode = {
        type: 'tabularArray',
        key: 'projects',
        count: 2,
        fields: ['id', 'name'],
        position: p,
        rows: [row([n(1), s('VAAYU')]), row([n(2), s('ClipForge')])],
      };
      const body: BodyNode[] = [kv('org', s('YugenLab')), tab];
      const ast = doc(body, headers, d);
      const pretty = prettyPrint(ast, { sectionSpacing: 0 });
      const reparsed = parse(pretty);
      expect(reparsed.headers).toHaveLength(2);
      expect(reparsed.dictionary).not.toBeNull();
      expect(reparsed.body).toHaveLength(2);
    });

    it('should round-trip comments and nested objects', () => {
      const ast = doc(
        [cmt('config section'), obj('server', [kv('host', s('localhost')), kv('port', n(8080))])],
        [],
        null,
      );
      const pretty = prettyPrint(ast, { sectionSpacing: 0 });
      const reparsed = parse(pretty);
      expect(reparsed.body).toHaveLength(2);
      expect((reparsed.body[0] as CommentNode).type).toBe('comment');
      expect((reparsed.body[1] as ObjectNode).type).toBe('object');
      expect((reparsed.body[1] as ObjectNode).children).toHaveLength(2);
    });
  });

  describe('empty document', () => {
    it('should return empty string for empty document', () => {
      expect(prettyPrint(doc([]))).toBe('');
    });
  });
});
