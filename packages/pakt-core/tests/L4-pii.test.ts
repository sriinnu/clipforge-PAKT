/**
 * @module tests/L4-pii
 * Tests for the L4 PII strategy: off/flag/redact mode behaviour, header
 * injection and replacement, reversible-mapping plumbing, and the
 * interaction with the compress() pipeline via PaktOptions.piiMode.
 */

import { describe, expect, it } from 'vitest';
import { compress } from '../src/compress.js';
import { decompress } from '../src/decompress.js';
import { applyPIILayer } from '../src/layers/L4-pii.js';

describe('applyPIILayer', () => {
  describe('off mode', () => {
    it('is a no-op when mode is omitted', () => {
      const input = 'hello alice@example.com world';
      const result = applyPIILayer(input);
      expect(result.text).toBe(input);
      expect(result.applied).toBe(false);
      expect(result.lossy).toBe(false);
    });

    it('is a no-op when mode is explicitly off', () => {
      const input = 'hello alice@example.com world';
      const result = applyPIILayer(input, { mode: 'off' });
      expect(result.text).toBe(input);
      expect(result.applied).toBe(false);
    });
  });

  describe('flag mode', () => {
    it('leaves the body unchanged and injects a pii warning header', () => {
      const input = '@from json\nuser: alice@example.com';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.applied).toBe(true);
      expect(result.lossy).toBe(false);
      expect(result.text).toContain('@warning pii email=1');
      expect(result.text).toContain('alice@example.com');
      expect(result.counts.email).toBe(1);
    });

    it('formats counts sorted by kind name', () => {
      const input = 'ip 10.0.0.1, mail alice@example.com, another bob@example.com';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.text).toContain('@warning pii email=2,ipv4=1');
    });

    it('returns unchanged when no PII is found', () => {
      const input = 'nothing sensitive here';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.applied).toBe(false);
      expect(result.text).toBe(input);
    });

    it('replaces an existing @warning pii header in place', () => {
      const input = '@from json\n@warning pii email=99\nuser: alice@example.com';
      const result = applyPIILayer(input, { mode: 'flag' });
      const occurrences = (result.text.match(/@warning pii/g) ?? []).length;
      expect(occurrences).toBe(1);
      expect(result.text).toContain('@warning pii email=1');
    });

    it('preserves CRLF line endings when injecting the header', () => {
      /* Regression: a prior version split on `\n` only, leaving `\r` as
         the last character of neighbouring lines. The rejoin used `\n`
         too, producing inconsistent line endings around the inserted
         header on CRLF inputs. */
      const input = '@version 1\r\n@from json\r\nuser: alice@example.com\r\n';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.applied).toBe(true);
      expect(result.text).not.toMatch(/[^\r]\n/);
      expect(result.text).toContain('\r\n@warning pii email=1\r\n');
    });

    it('preserves CRLF when replacing an existing pii header', () => {
      const input = '@from json\r\n@warning pii email=99\r\nuser: alice@example.com\r\n';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.text).not.toMatch(/[^\r]\n/);
      expect(result.text).toContain('\r\n@warning pii email=1\r\n');
    });

    it('normalises mixed line endings to CRLF when any CRLF is present', () => {
      /* Mixed-ending documents adopt CRLF as the dominant ending so the
         inserted header line is never the odd one out. */
      const input = '@version 1\r\n@from json\nuser: alice@example.com\n';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.applied).toBe(true);
      /* No bare `\n` may survive — every newline must be `\r\n`. */
      expect(result.text).not.toMatch(/[^\r]\n/);
      expect(result.text).toContain('\r\n@warning pii email=1\r\n');
    });

    it('keeps pure-LF documents free of carriage returns', () => {
      const input = '@version 1\n@from json\nuser: alice@example.com\n';
      const result = applyPIILayer(input, { mode: 'flag' });
      expect(result.applied).toBe(true);
      expect(result.text).not.toContain('\r');
      expect(result.text).toContain('\n@warning pii email=1\n');
    });

    it('roundtrips a CRLF document through header injection and decompress', () => {
      /* End-to-end: a real compressed PAKT document converted to CRLF
         (e.g. Windows clipboard transport), flagged, must still parse
         and decompress back to the original data. */
      const source = { users: [{ name: 'alice', email: 'alice@example.com' }] };
      const { compressed } = compress(JSON.stringify(source), { fromFormat: 'json' });
      const crlf = compressed.replace(/\n/g, '\r\n');
      const flagged = applyPIILayer(crlf, { mode: 'flag' });
      expect(flagged.applied).toBe(true);
      expect(flagged.text).not.toMatch(/[^\r]\n/);
      const back = decompress(flagged.text, 'json');
      expect(back.data).toEqual(source);
    });
  });

  describe('redact mode', () => {
    it('substitutes placeholders and flags the result as lossy', () => {
      const input = '@from json\nuser: alice@example.com';
      const result = applyPIILayer(input, { mode: 'redact' });
      expect(result.applied).toBe(true);
      expect(result.lossy).toBe(true);
      expect(result.text).not.toContain('alice@example.com');
      expect(result.text).toContain('[EMAIL]');
      expect(result.text).toContain('@warning pii email=1');
    });

    it('emits a mapping when reversible is true', () => {
      const input = 'ship to alice@example.com';
      const result = applyPIILayer(input, { mode: 'redact', reversible: true });
      expect(result.mapping).toBeDefined();
      expect(Object.values(result.mapping ?? {})).toContain('alice@example.com');
    });

    it('omits the mapping by default', () => {
      const input = 'ship to alice@example.com';
      const result = applyPIILayer(input, { mode: 'redact' });
      expect(result.mapping).toBeUndefined();
    });

    it('returns unchanged when no PII is found', () => {
      const input = 'nothing sensitive here';
      const result = applyPIILayer(input, { mode: 'redact' });
      expect(result.applied).toBe(false);
      expect(result.lossy).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// compress() pipeline integration
// ---------------------------------------------------------------------------

describe('compress() with piiMode option', () => {
  const json = JSON.stringify({ contact: { email: 'alice@example.com' } });

  it('does nothing when piiMode is omitted', () => {
    const result = compress(json, { fromFormat: 'json' });
    expect(result.compressed).not.toContain('@warning pii');
    expect(result.piiCounts).toBeUndefined();
    expect(result.piiMapping).toBeUndefined();
  });

  it('flags PII without mutating values', () => {
    const result = compress(json, { fromFormat: 'json', piiMode: 'flag' });
    expect(result.compressed).toContain('@warning pii');
    expect(result.compressed).toContain('alice@example.com');
    expect(result.reversible).toBe(true);
    expect(result.piiCounts?.email).toBe(1);
    expect(result.piiMapping).toBeUndefined();
  });

  it('redacts PII and marks the result lossy via reversible=false', () => {
    const result = compress(json, {
      fromFormat: 'json',
      piiMode: 'redact',
    });
    expect(result.compressed).toContain('[EMAIL]');
    expect(result.compressed).not.toContain('alice@example.com');
    expect(result.reversible).toBe(false);
    expect(result.piiCounts?.email).toBe(1);
  });

  it('returns a reversible mapping when piiReversible is true', () => {
    const result = compress(json, {
      fromFormat: 'json',
      piiMode: 'redact',
      piiReversible: true,
    });
    expect(result.piiMapping).toBeDefined();
    expect(Object.values(result.piiMapping ?? {})).toContain('alice@example.com');
  });

  it('scans text/markdown inputs that take the passthrough branch', () => {
    /* Regression: text / markdown / pakt inputs bypass `compressPipeline`
       via `tryCompressSpecialFormats`. The PII post-pass must still
       run on their output, otherwise redact mode would silently leak. */
    const md = '# title\n\ncontact: alice@example.com';
    const result = compress(md, { fromFormat: 'markdown', piiMode: 'redact' });
    expect(result.compressed).not.toContain('alice@example.com');
    expect(result.compressed).toContain('[EMAIL]');
    expect(result.piiCounts?.email).toBe(1);
    expect(result.reversible).toBe(false);
  });

  it('scans plain text passthrough and flags PII', () => {
    const plain = 'the admin account is alice@example.com';
    const result = compress(plain, { fromFormat: 'text', piiMode: 'flag' });
    expect(result.compressed).toContain('@warning pii email=1');
    expect(result.compressed).toContain('alice@example.com');
    expect(result.piiCounts?.email).toBe(1);
  });

  it('honours the piiKinds whitelist', () => {
    const mixed = JSON.stringify({
      email: 'alice@example.com',
      ip: '10.0.0.1',
    });
    const result = compress(mixed, {
      fromFormat: 'json',
      piiMode: 'flag',
      piiKinds: ['email'],
    });
    expect(result.piiCounts?.email).toBe(1);
    expect(result.piiCounts?.ipv4).toBeUndefined();
  });
});
