import { describe, expect, it } from 'vitest';
import type {
  BodyNode,
  CommentNode,
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
import { toCsv } from '../src/reverse/to-csv.js';
import { toJson } from '../src/reverse/to-json.js';
import { toMarkdown } from '../src/reverse/to-markdown.js';
import { toText } from '../src/reverse/to-text.js';
import { toYaml } from '../src/reverse/to-yaml.js';

// -- Helpers ---------------------------------------------------------------

const p = createPosition(1, 1, 0);
const str = (v: string, q = false): ScalarNode => ({
  type: 'scalar',
  scalarType: 'string',
  value: v,
  quoted: q,
  position: p,
});
const num = (v: number, r?: string): ScalarNode => ({
  type: 'scalar',
  scalarType: 'number',
  value: v,
  raw: r ?? String(v),
  position: p,
});
const bool = (v: boolean): ScalarNode => ({
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

// -- toJson ----------------------------------------------------------------

describe('toJson', () => {
  it('should convert a flat object to JSON', () => {
    const body: BodyNode[] = [
      kv('name', str('Sriinnu')),
      kv('age', num(28)),
      kv('active', bool(true)),
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ name: 'Sriinnu', age: 28, active: true });
  });

  it('should convert a nested object to JSON', () => {
    const body: BodyNode[] = [
      obj('user', [kv('name', str('Alice')), kv('role', str('developer'))]),
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ user: { name: 'Alice', role: 'developer' } });
  });

  it('should convert a deeply nested object', () => {
    const body: BodyNode[] = [
      obj('config', [obj('database', [kv('host', str('localhost')), kv('port', num(5432))])]),
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      config: { database: { host: 'localhost', port: 5432 } },
    });
  });

  it('should convert a tabular array to JSON', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'projects',
      count: 2,
      fields: ['id', 'name', 'status'],
      position: p,
      rows: [
        row([num(1), str('VAAYU'), str('active')]),
        row([num(2), str('ClipForge'), str('planning')]),
      ],
    };
    const json = toJson([tab]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      projects: [
        { id: 1, name: 'VAAYU', status: 'active' },
        { id: 2, name: 'ClipForge', status: 'planning' },
      ],
    });
  });

  it('should convert an inline array to JSON', () => {
    const arr: InlineArrayNode = {
      type: 'inlineArray',
      key: 'tags',
      count: 3,
      position: p,
      values: [str('React'), str('TypeScript'), str('Rust')],
    };
    const json = toJson([arr]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ tags: ['React', 'TypeScript', 'Rust'] });
  });

  it('should convert a list array to JSON', () => {
    const list: ListArrayNode = {
      type: 'listArray',
      key: 'events',
      count: 2,
      position: p,
      items: [
        item([kv('type', str('deploy')), kv('success', bool(true))]),
        item([kv('type', str('alert')), kv('message', str('CPU spike'))]),
      ],
    };
    const json = toJson([list]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      events: [
        { type: 'deploy', success: true },
        { type: 'alert', message: 'CPU spike' },
      ],
    });
  });

  it('should handle a mixed document', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'services',
      count: 2,
      fields: ['name', 'port'],
      position: p,
      rows: [row([str('auth'), num(8080)]), row([str('api'), num(8081)])],
    };
    const body: BodyNode[] = [
      kv('apiVersion', str('v2')),
      obj('server', [kv('hostname', str('prod-east-1'))]),
      tab,
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      apiVersion: 'v2',
      server: { hostname: 'prod-east-1' },
      services: [
        { name: 'auth', port: 8080 },
        { name: 'api', port: 8081 },
      ],
    });
  });

  it('should skip comment nodes', () => {
    const body: BodyNode[] = [
      cmt('this is a comment'),
      kv('name', str('Alice')),
      cmt('another comment'),
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ name: 'Alice' });
  });

  it('should handle null values', () => {
    const body: BodyNode[] = [kv('name', str('Alice')), kv('bio', nil())];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ name: 'Alice', bio: null });
  });

  it('should preserve type fidelity -- quoted "42" stays string', () => {
    const body: BodyNode[] = [
      kv('id', str('42', true)),
      kv('flag', str('true', true)),
      kv('empty', str('null', true)),
    ];
    const json = toJson(body);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe('42');
    expect(typeof parsed.id).toBe('string');
    expect(parsed.flag).toBe('true');
    expect(typeof parsed.flag).toBe('string');
    expect(parsed.empty).toBe('null');
    expect(typeof parsed.empty).toBe('string');
  });

  it('should handle empty body as empty object', () => {
    const json = toJson([]);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({});
  });

  it('should respect custom indent parameter', () => {
    const body: BodyNode[] = [kv('x', num(1))];
    const json4 = toJson(body, 4);
    expect(json4).toBe('{\n    "x": 1\n}');
  });

  it('should produce valid JSON that round-trips through JSON.parse', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'employees',
      count: 3,
      fields: ['id', 'name', 'active'],
      position: p,
      rows: [
        row([num(1), str('Alice'), bool(true)]),
        row([num(2), str('Bob'), bool(false)]),
        row([num(3), str('Carol'), nil()]),
      ],
    };
    const body: BodyNode[] = [
      kv('company', str('Acme')),
      obj('meta', [kv('version', str('2.0'))]),
      tab,
    ];
    const json = toJson(body);
    // Must not throw
    const parsed = JSON.parse(json);
    // Re-stringify must match
    expect(JSON.stringify(parsed, null, 2)).toBe(json);
  });
});

// -- toYaml ----------------------------------------------------------------

describe('toYaml', () => {
  it('should convert flat key-value pairs to YAML', () => {
    const body: BodyNode[] = [
      kv('name', str('Sriinnu')),
      kv('age', num(28)),
      kv('active', bool(true)),
    ];
    const yaml = toYaml(body);
    expect(yaml).toBe('name: Sriinnu\nage: 28\nactive: true\n');
  });

  it('should convert a nested object to YAML', () => {
    const body: BodyNode[] = [
      obj('user', [kv('name', str('Alice')), kv('role', str('developer'))]),
    ];
    const yaml = toYaml(body);
    expect(yaml).toBe('user:\n  name: Alice\n  role: developer\n');
  });

  it('should convert a deeply nested object to YAML', () => {
    const body: BodyNode[] = [
      obj('config', [obj('db', [kv('host', str('localhost')), kv('port', num(5432))])]),
    ];
    const yaml = toYaml(body);
    expect(yaml).toBe('config:\n  db:\n    host: localhost\n    port: 5432\n');
  });

  it('should convert tabular arrays to YAML sequences', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'users',
      count: 2,
      fields: ['name', 'role'],
      position: p,
      rows: [row([str('Alice'), str('dev')]), row([str('Bob'), str('admin')])],
    };
    const yaml = toYaml([tab]);
    expect(yaml).toBe(
      'users:\n' +
        '  - name: Alice\n' +
        '    role: dev\n' +
        '  - name: Bob\n' +
        '    role: admin\n',
    );
  });

  it('should convert inline arrays to YAML sequences', () => {
    const arr: InlineArrayNode = {
      type: 'inlineArray',
      key: 'tags',
      count: 3,
      position: p,
      values: [str('React'), str('TypeScript'), str('Rust')],
    };
    const yaml = toYaml([arr]);
    expect(yaml).toBe('tags: [React, TypeScript, Rust]\n');
  });

  it('should convert list arrays to YAML sequences', () => {
    const list: ListArrayNode = {
      type: 'listArray',
      key: 'events',
      count: 2,
      position: p,
      items: [
        item([kv('type', str('deploy')), kv('success', bool(true))]),
        item([kv('type', str('alert')), kv('msg', str('high CPU'))]),
      ],
    };
    const yaml = toYaml([list]);
    expect(yaml).toBe(
      'events:\n' +
        '  - type: deploy\n' +
        '    success: true\n' +
        '  - type: alert\n' +
        '    msg: high CPU\n',
    );
  });

  it('should quote strings containing colons', () => {
    const body: BodyNode[] = [kv('msg', str('Error: failed'))];
    const yaml = toYaml(body);
    expect(yaml).toBe('msg: "Error: failed"\n');
  });

  it('should quote strings containing hash', () => {
    const body: BodyNode[] = [kv('note', str('item #1'))];
    const yaml = toYaml(body);
    expect(yaml).toBe('note: "item #1"\n');
  });

  it('should handle null values', () => {
    const body: BodyNode[] = [kv('bio', nil())];
    const yaml = toYaml(body);
    expect(yaml).toBe('bio: null\n');
  });

  it('should handle empty body', () => {
    expect(toYaml([])).toBe('');
  });

  it('should skip comments', () => {
    const body: BodyNode[] = [cmt('skip me'), kv('x', num(1))];
    const yaml = toYaml(body);
    expect(yaml).toBe('x: 1\n');
  });
});

// -- toCsv -----------------------------------------------------------------

describe('toCsv', () => {
  it('should convert tabular data to CSV', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'projects',
      count: 2,
      fields: ['id', 'name', 'status'],
      position: p,
      rows: [
        row([num(1), str('VAAYU'), str('active')]),
        row([num(2), str('ClipForge'), str('planning')]),
      ],
    };
    const csv = toCsv([tab]);
    expect(csv).toBe('id,name,status\r\n1,VAAYU,active\r\n2,ClipForge,planning\r\n');
  });

  it('should convert flat key-value pairs to CSV', () => {
    const body: BodyNode[] = [
      kv('name', str('Alice')),
      kv('age', num(30)),
      kv('active', bool(true)),
    ];
    const csv = toCsv(body);
    expect(csv).toBe('name,age,active\r\nAlice,30,true\r\n');
  });

  it('should quote values containing commas', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 1,
      fields: ['id', 'value'],
      position: p,
      rows: [row([num(1), str('hello, world')])],
    };
    const csv = toCsv([tab]);
    expect(csv).toBe('id,value\r\n1,"hello, world"\r\n');
  });

  it('should quote values containing double quotes', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 1,
      fields: ['id', 'value'],
      position: p,
      rows: [row([num(1), str('say "hi"')])],
    };
    const csv = toCsv([tab]);
    expect(csv).toBe('id,value\r\n1,"say ""hi"""\r\n');
  });

  it('should handle null values as empty cells', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 1,
      fields: ['id', 'value'],
      position: p,
      rows: [row([num(1), nil()])],
    };
    const csv = toCsv([tab]);
    expect(csv).toBe('id,value\r\n1,\r\n');
  });

  it('should throw for non-tabular data', () => {
    const body: BodyNode[] = [obj('user', [kv('name', str('Alice'))])];
    expect(() => toCsv(body)).toThrow('Cannot convert to CSV: no tabular data found');
  });

  it('should throw for empty body', () => {
    expect(() => toCsv([])).toThrow('Cannot convert to CSV: no tabular data found');
  });

  it('should skip comments when checking for flat KV', () => {
    const body: BodyNode[] = [cmt('comment'), kv('a', num(1)), kv('b', num(2))];
    const csv = toCsv(body);
    expect(csv).toBe('a,b\r\n1,2\r\n');
  });
});

// -- toMarkdown ------------------------------------------------------------

describe('toMarkdown', () => {
  it('should convert tabular data to a Markdown table', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'projects',
      count: 2,
      fields: ['id', 'name', 'status'],
      position: p,
      rows: [
        row([num(1), str('VAAYU'), str('active')]),
        row([num(2), str('ClipForge'), str('planning')]),
      ],
    };
    const md = toMarkdown([tab]);
    expect(md).toBe(
      '| id | name | status |\n' +
        '| --- | --- | --- |\n' +
        '| 1 | VAAYU | active |\n' +
        '| 2 | ClipForge | planning |\n',
    );
  });

  it('should convert flat key-value pairs to a Key-Value table', () => {
    const body: BodyNode[] = [kv('name', str('Alice')), kv('age', num(30))];
    const md = toMarkdown(body);
    expect(md).toBe(
      '| Key | Value |\n' + '| --- | --- |\n' + '| name | Alice |\n' + '| age | 30 |\n',
    );
  });

  it('should handle mixed data with sections', () => {
    const body: BodyNode[] = [
      kv('status', str('active')),
      obj('server', [kv('host', str('localhost'))]),
    ];
    const md = toMarkdown(body);
    expect(md).toContain('**status**: active');
    expect(md).toContain('## server');
    expect(md).toContain('- **host**: localhost');
  });

  it('should escape pipe characters in table cells', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'data',
      count: 1,
      fields: ['id', 'formula'],
      position: p,
      rows: [row([num(1), str('a|b')])],
    };
    const md = toMarkdown([tab]);
    expect(md).toContain('a\\|b');
  });

  it('should handle null values in tables', () => {
    const body: BodyNode[] = [kv('name', str('Alice')), kv('bio', nil())];
    const md = toMarkdown(body);
    expect(md).toContain('*null*');
  });

  it('should handle empty body', () => {
    expect(toMarkdown([])).toBe('');
  });

  it('should handle inline arrays in mixed data', () => {
    const arr: InlineArrayNode = {
      type: 'inlineArray',
      key: 'tags',
      count: 2,
      position: p,
      values: [str('React'), str('Rust')],
    };
    const body: BodyNode[] = [kv('name', str('project')), arr];
    const md = toMarkdown(body);
    expect(md).toContain('**tags**:');
    expect(md).toContain('- React');
    expect(md).toContain('- Rust');
  });

  it('should handle list arrays in mixed data', () => {
    const list: ListArrayNode = {
      type: 'listArray',
      key: 'events',
      count: 1,
      position: p,
      items: [item([kv('type', str('deploy'))])],
    };
    const body: BodyNode[] = [kv('status', str('ok')), list];
    const md = toMarkdown(body);
    expect(md).toContain('**events**:');
    expect(md).toContain('**type**: deploy');
  });
});

// -- toText ----------------------------------------------------------------

describe('toText', () => {
  it('should convert flat key-value pairs to text', () => {
    const body: BodyNode[] = [
      kv('name', str('Alice')),
      kv('age', num(30)),
      kv('active', bool(true)),
    ];
    const text = toText(body);
    expect(text).toBe('name: Alice\nage: 30\nactive: true\n');
  });

  it('should convert nested objects with indentation', () => {
    const body: BodyNode[] = [
      obj('user', [kv('name', str('Alice')), kv('role', str('developer'))]),
    ];
    const text = toText(body);
    expect(text).toBe('user:\n  name: Alice\n  role: developer\n');
  });

  it('should convert tabular arrays to numbered items', () => {
    const tab: TabularArrayNode = {
      type: 'tabularArray',
      key: 'users',
      count: 2,
      fields: ['name', 'role'],
      position: p,
      rows: [row([str('Alice'), str('dev')]), row([str('Bob'), str('admin')])],
    };
    const text = toText([tab]);
    expect(text).toContain('users:');
    expect(text).toContain('1.');
    expect(text).toContain('name: Alice');
    expect(text).toContain('role: dev');
    expect(text).toContain('2.');
    expect(text).toContain('name: Bob');
  });

  it('should convert inline arrays to bullet lists', () => {
    const arr: InlineArrayNode = {
      type: 'inlineArray',
      key: 'tags',
      count: 3,
      position: p,
      values: [str('React'), str('TypeScript'), str('Rust')],
    };
    const text = toText([arr]);
    expect(text).toBe('tags:\n  - React\n  - TypeScript\n  - Rust\n');
  });

  it('should convert list arrays to numbered items', () => {
    const list: ListArrayNode = {
      type: 'listArray',
      key: 'events',
      count: 2,
      position: p,
      items: [
        item([kv('type', str('deploy')), kv('success', bool(true))]),
        item([kv('type', str('alert')), kv('msg', str('CPU spike'))]),
      ],
    };
    const text = toText([list]);
    expect(text).toContain('events:');
    expect(text).toContain('1.');
    expect(text).toContain('type: deploy');
    expect(text).toContain('success: true');
    expect(text).toContain('2.');
    expect(text).toContain('type: alert');
  });

  it('should handle null values', () => {
    const body: BodyNode[] = [kv('bio', nil())];
    const text = toText(body);
    expect(text).toBe('bio: null\n');
  });

  it('should skip comments', () => {
    const body: BodyNode[] = [cmt('skip'), kv('x', num(1))];
    const text = toText(body);
    expect(text).toBe('x: 1\n');
  });

  it('should handle empty body', () => {
    expect(toText([])).toBe('');
  });

  it('should handle deeply nested objects', () => {
    const body: BodyNode[] = [obj('a', [obj('b', [kv('c', str('deep'))])])];
    const text = toText(body);
    expect(text).toBe('a:\n  b:\n    c: deep\n');
  });
});
