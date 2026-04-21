/**
 * @module tests/pii-detector
 * Tests for the PII detector: per-kind regex coverage, Luhn check on
 * credit-card candidates, overlap resolution priority, and the `kinds`
 * whitelist option.
 */

import { describe, expect, it } from 'vitest';
import { detectPII, redactPII } from '../src/pii/index.js';

describe('detectPII', () => {
  it('detects an email', () => {
    const matches = detectPII('contact: alice@example.com today');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('email');
    expect(matches[0]?.value).toBe('alice@example.com');
  });

  it('detects an IPv4 address', () => {
    const matches = detectPII('server 192.168.1.10 is up');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('ipv4');
    expect(matches[0]?.value).toBe('192.168.1.10');
  });

  it('detects an IPv6 address', () => {
    const matches = detectPII('node 2001:db8::8a2e:370:7334 is up');
    const ipv6 = matches.find((m) => m.kind === 'ipv6');
    expect(ipv6).toBeDefined();
  });

  it('detects a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const matches = detectPII(`token=${jwt}`);
    expect(matches.some((m) => m.kind === 'jwt')).toBe(true);
  });

  it('detects an AWS access key', () => {
    const matches = detectPII('AKIAIOSFODNN7EXAMPLE');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('aws-access-key');
  });

  it('detects an AWS secret key with the usual label', () => {
    const matches = detectPII(
      'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    expect(matches.some((m) => m.kind === 'aws-secret-key')).toBe(true);
  });

  it('validates credit-card candidates via Luhn', () => {
    /* Valid (Luhn-compliant) test card 4242 4242 4242 4242. */
    const valid = detectPII('card: 4242 4242 4242 4242');
    expect(valid.some((m) => m.kind === 'credit-card')).toBe(true);

    /* Invalid: identical digit repeat, fails checksum. */
    const invalid = detectPII('card: 1111 1111 1111 1111');
    expect(invalid.some((m) => m.kind === 'credit-card')).toBe(false);
  });

  it('detects a dashed SSN', () => {
    const matches = detectPII('ssn: 123-45-6789');
    expect(matches.some((m) => m.kind === 'ssn')).toBe(true);
  });

  it('returns an empty array on empty input', () => {
    expect(detectPII('')).toEqual([]);
  });

  it('returns matches sorted by start offset with no overlap', () => {
    const matches = detectPII('a@b.com then 10.0.0.1 then c@d.com');
    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1];
      const curr = matches[i];
      expect(prev && curr && prev.end).toBeLessThanOrEqual(curr?.start ?? Infinity);
    }
  });

  it('honours the `kinds` whitelist', () => {
    const text = 'a@b.com 10.0.0.1';
    const emailsOnly = detectPII(text, { kinds: ['email'] });
    expect(emailsOnly).toHaveLength(1);
    expect(emailsOnly[0]?.kind).toBe('email');
  });

  it('does not misread dotted-hyphen version strings as IPv4', () => {
    const matches = detectPII('release 1.2.3.4-beta is out');
    expect(matches.some((m) => m.kind === 'ipv4')).toBe(false);
  });

  it('does not misread leading-hyphen version strings as IPv4', () => {
    const matches = detectPII('tag v-1.2.3.4 shipped');
    expect(matches.some((m) => m.kind === 'ipv4')).toBe(false);
  });

  it('returns empty for inputs exceeding the length cap', () => {
    /* Library-level guard: detectPII refuses to scan adversarially large
       inputs rather than risk ReDoS in the IPv6 / phone patterns. */
    const huge = `email alice@example.com `.repeat(50_000); // ~1.2 MB
    expect(detectPII(huge)).toEqual([]);
  });

  it('skips IPv6 detection when text has no plausible shape', () => {
    /* The pre-filter avoids invoking the expensive alternation on text
       that couldn't possibly contain an IPv6 value. */
    const matches = detectPII('just some plain text with no colons');
    expect(matches.some((m) => m.kind === 'ipv6')).toBe(false);
  });
});

describe('redactPII', () => {
  it('replaces detected PII with default placeholders', () => {
    const { text, counts } = redactPII('hi alice@example.com, ip 10.0.0.1');
    expect(text).toBe('hi [EMAIL], ip [IP]');
    expect(counts.email).toBe(1);
    expect(counts.ipv4).toBe(1);
  });

  it('uses the same placeholder for repeated occurrences of one value', () => {
    const { text, counts } = redactPII(
      'a alice@example.com b alice@example.com c',
    );
    expect(text).toBe('a [EMAIL] b [EMAIL] c');
    expect(counts.email).toBe(2);
  });

  it('returns a reversible mapping when requested', () => {
    const { text, mapping } = redactPII('send to alice@example.com', {
      reversible: true,
      placeholderFor: (kind, i) => `[${kind.toUpperCase()}_${i}]`,
    });
    expect(text).toBe('send to [EMAIL_1]');
    expect(mapping).toEqual({ '[EMAIL_1]': 'alice@example.com' });
  });

  it('passes through text with no PII untouched', () => {
    const { text, redactions } = redactPII('nothing sensitive here');
    expect(text).toBe('nothing sensitive here');
    expect(redactions).toEqual([]);
  });
});
