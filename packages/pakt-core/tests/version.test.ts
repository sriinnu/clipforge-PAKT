/**
 * @module tests/version
 * VERSION must match package.json; it was hand-kept and drifted to 0.10.0
 * while the package shipped 0.12.x.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('VERSION', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });
});
