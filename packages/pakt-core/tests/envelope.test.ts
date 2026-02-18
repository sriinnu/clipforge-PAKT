/**
 * HTTP envelope detection and compression tests.
 *
 * Validates that mixed content (HTTP response headers + JSON body)
 * is correctly detected, compressed, and decompressed with envelope
 * metadata preserved.
 */
import { describe, it, expect } from 'vitest';
import { compress, decompress, detect } from '../src/index.js';

// ---------------------------------------------------------------------------
// Detection tests
// ---------------------------------------------------------------------------

describe('HTTP envelope detection', () => {
  it('detects HTTP/1.1 response with JSON body', () => {
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      'Vary: Accept',
      '',
      '{"name": "Alice", "role": "dev"}',
    ].join('\n');

    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.type).toBe('http');
    expect(result.envelope!.preamble).toEqual([
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      'Vary: Accept',
    ]);
  });

  it('detects HTTP/2 response', () => {
    const input = [
      'HTTP/2 200',
      'Content-Type: application/json',
      '',
      '[{"id": 1}]',
    ].join('\n');

    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.preamble[0]).toBe('HTTP/2 200');
  });

  it('detects shorthand HTTP response (no version)', () => {
    const input = [
      'HTTP 200 OK',
      'Allow: GET, HEAD, OPTIONS',
      'Content-Type: application/json',
      '',
      '{"data": [1, 2, 3]}',
    ].join('\n');

    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.preamble).toHaveLength(3);
  });

  it('detects body without blank line separator', () => {
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '{"items": []}',
    ].join('\n');

    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.envelope).toBeDefined();
    expect(result.envelope!.preamble).toEqual([
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
    ]);
  });

  it('detects array body in HTTP response', () => {
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      '[{"id": 1, "name": "Widget"}, {"id": 2, "name": "Gadget"}]',
    ].join('\n');

    const result = detect(input);
    expect(result.format).toBe('json');
    expect(result.envelope).toBeDefined();
  });

  it('returns no envelope for plain JSON', () => {
    const result = detect('{"name": "Alice"}');
    expect(result.format).toBe('json');
    expect(result.envelope).toBeUndefined();
  });

  it('returns no envelope for plain text', () => {
    const result = detect('Hello, world!');
    expect(result.envelope).toBeUndefined();
  });

  it('returns no envelope for YAML', () => {
    const result = detect('name: Alice\nrole: dev');
    expect(result.envelope).toBeUndefined();
  });

  it('requires at least status line + 1 header', () => {
    const input = 'HTTP/1.1 200 OK\n\n{"data": 1}';
    const result = detect(input);
    // Only 1 preamble line (status) — not enough for envelope
    expect(result.envelope).toBeUndefined();
  });

  it('rejects non-HTTP first line', () => {
    const input = [
      'SMTP 250 OK',
      'Content-Type: text/plain',
      '',
      '{"ok": true}',
    ].join('\n');

    const result = detect(input);
    expect(result.envelope).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Compression tests
// ---------------------------------------------------------------------------

describe('HTTP envelope compression', () => {
  const HTTP_JSON = [
    'HTTP/1.1 200 OK',
    'Content-Type: application/json',
    'Vary: Accept',
    '',
    JSON.stringify({
      users: [
        { name: 'Alice', role: 'developer', active: true },
        { name: 'Bob', role: 'designer', active: false },
        { name: 'Carol', role: 'developer', active: true },
      ],
    }),
  ].join('\n');

  it('compresses the JSON body and stores envelope as comments', () => {
    const result = compress(HTTP_JSON);
    expect(result.compressed).toContain('% @envelope http');
    expect(result.compressed).toContain('% HTTP/1.1 200 OK');
    expect(result.compressed).toContain('% Content-Type: application/json');
    expect(result.compressed).toContain('% Vary: Accept');
    expect(result.detectedFormat).toBe('json');
  });

  it('achieves positive savings on HTTP+JSON (large body)', () => {
    const largeBody = JSON.stringify({
      items: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        price: 9.99,
        category: 'electronics',
        active: true,
      })),
    });
    const largeInput = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      largeBody,
    ].join('\n');
    const result = compress(largeInput);
    expect(result.savings.totalPercent).toBeGreaterThan(0);
    expect(result.savings.byLayer.structural).toBeGreaterThan(0);
  });

  it('compresses body correctly (data accessible)', () => {
    const result = compress(HTTP_JSON);
    // The PAKT output should contain tabular array structure
    expect(result.compressed).toContain('{name|role|active}');
  });
});

// ---------------------------------------------------------------------------
// Roundtrip tests
// ---------------------------------------------------------------------------

describe('HTTP envelope roundtrip', () => {
  it('roundtrips JSON body losslessly and recovers envelope', () => {
    const body = { users: [{ name: 'Alice', role: 'dev' }, { name: 'Bob', role: 'admin' }] };
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      '',
      JSON.stringify(body),
    ].join('\n');

    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');

    // Data roundtrips losslessly
    expect(JSON.parse(decompressed.text)).toEqual(body);

    // Envelope is recovered
    expect(decompressed.envelope).toBeDefined();
    expect(decompressed.envelope).toEqual([
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
    ]);
  });

  it('roundtrips array body with envelope', () => {
    const body = [
      { id: 1, name: 'Widget', price: 9.99 },
      { id: 2, name: 'Gadget', price: 19.50 },
    ];
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      'X-Total-Count: 2',
      '',
      JSON.stringify(body),
    ].join('\n');

    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');

    expect(JSON.parse(decompressed.text)).toEqual(body);
    expect(decompressed.envelope).toContain('X-Total-Count: 2');
  });

  it('returns no envelope for regular PAKT (no envelope comments)', () => {
    const result = compress('{"name": "Alice"}');
    const decompressed = decompress(result.compressed, 'json');
    expect(decompressed.envelope).toBeUndefined();
  });

  it('handles many HTTP headers', () => {
    const body = { status: 'ok' };
    const input = [
      'HTTP/1.1 200 OK',
      'Content-Type: application/json',
      'Cache-Control: no-cache',
      'X-Request-Id: abc-123',
      'X-RateLimit-Remaining: 99',
      'Access-Control-Allow-Origin: *',
      '',
      JSON.stringify(body),
    ].join('\n');

    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');

    expect(decompressed.envelope).toHaveLength(6);
    expect(decompressed.envelope![0]).toBe('HTTP/1.1 200 OK');
    expect(JSON.parse(decompressed.text)).toEqual(body);
  });

  it('handles user-provided manufacturing data format', () => {
    const body = [
      { id: 1, machine: 'CNC-01', operator: 'Alice', status: 'running' },
      { id: 2, machine: 'CNC-02', operator: 'Bob', status: 'idle' },
    ];
    const input = [
      'HTTP 200 OK',
      'Allow: GET, HEAD, OPTIONS',
      'Content-Type: application/json',
      'Vary: Accept',
      '',
      JSON.stringify(body),
    ].join('\n');

    const compressed = compress(input);
    const decompressed = decompress(compressed.compressed, 'json');

    expect(JSON.parse(decompressed.text)).toEqual(body);
    expect(decompressed.envelope).toBeDefined();
    expect(decompressed.envelope).toContain('HTTP 200 OK');
    expect(decompressed.envelope).toContain('Allow: GET, HEAD, OPTIONS');
  });
});
