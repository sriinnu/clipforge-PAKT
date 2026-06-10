#!/usr/bin/env node
/**
 * Generate the extension icon set (icons/icon-{16,48,128}.png) — the PAKT
 * chevron-pipe mark (geometry kept in sync with assets/pakt-icon.svg),
 * rasterized at the three sizes Chrome's manifest.json declares with
 * per-size detail levels for small-raster legibility.
 *
 * Zero devDependencies: `sharp` is resolved from (in order)
 *   1. a normal `require('sharp')` if it happens to be installed locally,
 *   2. the npx package cache when invoked as
 *        npx -y -p sharp@0.34 node apps/extension/scripts/generate-icons.mjs
 *      (npx prepends `<cache>/node_modules/.bin` to PATH; we walk PATH to
 *      find the sibling `sharp` package).
 *
 * Usage (from the repo root):
 *   npx -y -p sharp@0.34 node apps/extension/scripts/generate-icons.mjs
 */

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'icons');
const SIZES = [16, 48, 128];

/**
 * Resolve the `sharp` module without requiring it as a devDependency.
 * Falls back to scanning PATH for an npx cache directory (`.../_npx/<hash>/
 * node_modules/.bin`) that npx adds when run with `-p sharp`.
 *
 * @returns {import('sharp')} The sharp factory function.
 * @throws {Error} When sharp cannot be found anywhere.
 */
function loadSharp() {
  const require = createRequire(import.meta.url);
  try {
    return require('sharp');
  } catch {
    // Not installed locally — look for the npx-provided copy on PATH.
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry.includes('_npx')) continue;
    try {
      // PATH entry is <cache>/node_modules/.bin → package sits one level up.
      return require(join(entry, '..', 'sharp'));
    } catch {
      // Keep scanning; another PATH entry may hold it.
    }
  }
  throw new Error(
    'sharp not found. Run via:\n' +
      '  npx -y -p sharp@0.34 node apps/extension/scripts/generate-icons.mjs',
  );
}

/**
 * Build the square PAKT chevron-pipe mark at a given detail level.
 *
 * Geometry mirrors assets/pakt-icon.svg (the master mark — keep in sync):
 * two chevrons pressing inward onto a bright central pipe on a dark rounded
 * tile. Small rasters get thicker strokes and drop the low-opacity ghost
 * chevrons + rim, which would otherwise rasterize to mud.
 *
 * @param {{ stroke: number, pipe: number, ghosts: boolean }} opts - Detail
 *   level: main chevron stroke width, pipe width (both in 64-unit space),
 *   and whether the outer ghost chevrons + rim are drawn.
 * @returns {string} A standalone square SVG document.
 */
function buildIconSvg({ stroke, pipe, ghosts }) {
  const pipeX = (64 - pipe) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#151938"/><stop offset="1" stop-color="#0a0c1f"/>
    </linearGradient>
    <linearGradient id="pipe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c7d2fe"/><stop offset="0.5" stop-color="#818cf8"/><stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
    <linearGradient id="chevL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#818cf8"/>
    </linearGradient>
    <linearGradient id="chevR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14.5" fill="url(#tile)"/>
  ${
    ghosts
      ? `<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.75" fill="none" stroke="#818cf8" stroke-opacity="0.14" stroke-width="1.5"/>
  <path d="M 6,24.5 L 11,32 L 6,39.5" fill="none" stroke="#6366f1" stroke-opacity="0.35" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 58,24.5 L 53,32 L 58,39.5" fill="none" stroke="#8b5cf6" stroke-opacity="0.35" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : ''
  }
  <path d="M 16,18.5 L 24.8,32 L 16,45.5" fill="none" stroke="url(#chevL)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 48,18.5 L 39.2,32 L 48,45.5" fill="none" stroke="url(#chevR)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${pipeX}" y="14" width="${pipe}" height="36" rx="${pipe / 2}" fill="url(#pipe)"/>
</svg>`;
}

const sharp = loadSharp();
mkdirSync(OUT_DIR, { recursive: true });

/** Per-size detail levels — thicker strokes, less ornament at small sizes. */
const DETAIL_BY_SIZE = {
  16: { stroke: 7.5, pipe: 6.5, ghosts: false },
  48: { stroke: 6.2, pipe: 5.2, ghosts: true },
  128: { stroke: 5.6, pipe: 4.6, ghosts: true },
};

for (const size of SIZES) {
  const out = resolve(OUT_DIR, `icon-${size}.png`);
  const iconSvg = Buffer.from(buildIconSvg(DETAIL_BY_SIZE[size]));
  // High input density keeps strokes crisp when vips rasterizes the SVG.
  await sharp(iconSvg, { density: Math.ceil((72 * size) / 64) * 4 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}
