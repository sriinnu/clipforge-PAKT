/**
 * Generate PNG icons for the ClipForge extension.
 * Creates a white "P" letter on a purple (#7c3aed) background with rounded corners.
 * Sizes: 16x16, 48x48, 128x128.
 *
 * No external dependencies — uses raw PNG generation with zlib.
 *
 * Usage: node scripts/gen-icons.mjs
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '..', 'icons');

mkdirSync(iconsDir, { recursive: true });

// ---------------------------------------------------------------------------
// PNG helpers
// ---------------------------------------------------------------------------

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcInput);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

/**
 * Create a PNG with RGBA pixel data.
 */
function createPngRGBA(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // IDAT — raw pixel rows with filter byte
  const rowBytes = 1 + size * 4;
  const rawData = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const offset = y * rowBytes;
    rawData[offset] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const pi = (y * size + x) * 4;
      const px = offset + 1 + x * 4;
      rawData[px] = pixels[pi];
      rawData[px + 1] = pixels[pi + 1];
      rawData[px + 2] = pixels[pi + 2];
      rawData[px + 3] = pixels[pi + 3];
    }
  }
  const compressed = deflateSync(rawData);
  const idat = makeChunk('IDAT', compressed);

  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Check if point (px, py) is inside a rounded rectangle.
 * Returns 0.0-1.0 for anti-aliasing at edges.
 */
function roundedRectAlpha(px, py, x, y, w, h, r) {
  // Clamp radius
  r = Math.min(r, w / 2, h / 2);

  const left = x;
  const right = x + w;
  const top = y;
  const bottom = y + h;

  // Inside the inner rect (no rounding needed)?
  if (px >= left + r && px <= right - r && py >= top && py <= bottom) return 1.0;
  if (px >= left && px <= right && py >= top + r && py <= bottom - r) return 1.0;

  // Check each corner
  const corners = [
    [left + r, top + r],       // top-left
    [right - r, top + r],      // top-right
    [left + r, bottom - r],    // bottom-left
    [right - r, bottom - r],   // bottom-right
  ];

  for (const [cx, cy] of corners) {
    const inCornerRegion =
      (px < left + r && py < top + r && cx === left + r && cy === top + r) ||
      (px > right - r && py < top + r && cx === right - r && cy === top + r) ||
      (px < left + r && py > bottom - r && cx === left + r && cy === bottom - r) ||
      (px > right - r && py > bottom - r && cx === right - r && cy === bottom - r);

    if (inCornerRegion) {
      const d = distance(px, py, cx, cy);
      if (d > r + 0.7) return 0.0;
      if (d > r - 0.7) return Math.max(0, Math.min(1, (r + 0.7 - d) / 1.4));
      return 1.0;
    }
  }

  // Outside the bounding box
  if (px < left || px > right || py < top || py > bottom) return 0.0;

  return 1.0;
}

/**
 * Render the letter "P" as a bitmap glyph at a given size.
 * Returns a 2D boolean-ish alpha array.
 */
function renderLetterP(size) {
  const alpha = new Float32Array(size * size);

  // Scale all measurements relative to icon size
  const s = size;
  const margin = s * 0.18;

  // The "P" letter:
  // - Vertical stem on the left
  // - Bowl (rounded bump) on the top right

  const stemLeft = margin;
  const stemWidth = s * 0.2;
  const stemTop = margin;
  const stemBottom = s - margin;
  const stemHeight = stemBottom - stemTop;

  // Bowl
  const bowlLeft = stemLeft + stemWidth * 0.5;
  const bowlTop = stemTop;
  const bowlRight = s - margin;
  const bowlBottom = stemTop + stemHeight * 0.55;
  const bowlWidth = bowlRight - bowlLeft;
  const bowlHeight = bowlBottom - bowlTop;
  const bowlThickness = stemWidth;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let a = 0;

      // Vertical stem — rounded rect
      const stemR = stemWidth * 0.3;
      a = Math.max(a, roundedRectAlpha(px, py, stemLeft, stemTop, stemWidth, stemHeight, stemR));

      // Bowl outer — check if inside outer rounded rect
      const bowlR = bowlHeight * 0.45;
      const outerA = roundedRectAlpha(px, py, bowlLeft, bowlTop, bowlWidth, bowlHeight, bowlR);

      // Bowl inner (hole) — smaller rect inside
      const innerLeft = bowlLeft;
      const innerTop = bowlTop + bowlThickness;
      const innerWidth = bowlWidth - bowlThickness;
      const innerHeight = bowlHeight - bowlThickness * 2;
      const innerR = Math.max(0, bowlR - bowlThickness * 0.5);
      const innerA = innerWidth > 0 && innerHeight > 0
        ? roundedRectAlpha(px, py, innerLeft, innerTop, innerWidth, innerHeight, innerR)
        : 0;

      // Bowl = outer minus inner
      const bowlA = Math.max(0, outerA - innerA);
      a = Math.max(a, bowlA);

      alpha[y * size + x] = Math.min(1, a);
    }
  }

  return alpha;
}

// ---------------------------------------------------------------------------
// Generate icons
// ---------------------------------------------------------------------------

const BG_R = 124, BG_G = 58, BG_B = 237;  // #7c3aed
const FG_R = 255, FG_G = 255, FG_B = 255;  // white

const sizes = [16, 48, 128];

for (const size of sizes) {
  const pixels = new Uint8Array(size * size * 4);
  const cornerRadius = Math.round(size * 0.22);

  // Render the "P" glyph
  const letterAlpha = renderLetterP(size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // Background: rounded rect
      const bgA = roundedRectAlpha(px, py, 0, 0, size, size, cornerRadius);

      if (bgA <= 0) {
        // Transparent
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
        continue;
      }

      // Letter foreground
      const fgA = letterAlpha[y * size + x];

      // Composite: letter on top of background
      const r = Math.round(BG_R * (1 - fgA) + FG_R * fgA);
      const g = Math.round(BG_G * (1 - fgA) + FG_G * fgA);
      const b = Math.round(BG_B * (1 - fgA) + FG_B * fgA);
      const a = Math.round(bgA * 255);

      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = a;
    }
  }

  const png = createPngRGBA(size, pixels);
  const path = resolve(iconsDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Created ${path} (${png.length} bytes)`);
}
