// Renders the AssayPlot application icon to a 1024 px PNG.
//
//   node scripts/make-icon.mjs
//   npx tauri icon src-tauri/icons/source.png
//
// The mark is the app's own signature figure: three bars of decreasing height
// with their individual data points above them, which is what a dose-response
// bar chart looks like and what most people will draw first. Rendered here
// rather than imported so the icon is reproducible from source with no
// binary asset and no image toolchain.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SIZE = 1024;
const SUPERSAMPLE = 3; // 3x3 samples per pixel, for clean curves at small sizes

const INK = [12, 98, 89];        // petrol, the product accent
const INK_DEEP = [8, 74, 67];    // a slightly darker foot for depth
const PAPER = [247, 250, 249];   // bars
const POINT = [255, 255, 255];

/** Signed-distance helpers, evaluated per sample. */
const roundedRect = (x, y, left, top, right, bottom, radius) => {
  const dx = Math.max(left - x, 0, x - right);
  const dy = Math.max(top - y, 0, y - bottom);
  return Math.hypot(dx, dy) <= radius;
};
const insideRoundedRect = (x, y, left, top, right, bottom, radius) =>
  x >= left - radius && x <= right + radius && y >= top - radius && y <= bottom + radius &&
  roundedRect(x, y, left + radius, top + radius, right - radius, bottom - radius, radius);

const insideCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** Colour of the icon at a point in 0..1024 space, or null for transparent. */
function shade(x, y) {
  const s = SIZE / 1024;

  // App-icon squircle.
  if (!insideRoundedRect(x, y, 64 * s, 64 * s, 960 * s, 960 * s, 224 * s)) return null;

  // Bars: decreasing heights, the shape of a dose response.
  const bars = [
    { left: 232, right: 392, top: 392 },
    { left: 432, right: 592, top: 512 },
    { left: 632, right: 792, top: 632 },
  ];
  for (const bar of bars) {
    if (insideRoundedRect(x, y, bar.left * s, bar.top * s, bar.right * s, 800 * s, 18 * s)) {
      return PAPER;
    }
    // Two data points above each bar, offset like real replicates.
    const cx = ((bar.left + bar.right) / 2) * s;
    if (insideCircle(x, y, cx - 34 * s, (bar.top - 92) * s, 30 * s)) return POINT;
    if (insideCircle(x, y, cx + 38 * s, (bar.top - 158) * s, 30 * s)) return POINT;
  }

  // Baseline.
  if (insideRoundedRect(x, y, 200 * s, 800 * s, 824 * s, 826 * s, 13 * s)) return PAPER;

  // Ground, very slightly darker toward the bottom so the mark has weight.
  const t = y / SIZE;
  return INK.map((channel, i) => Math.round(channel + (INK_DEEP[i] - channel) * t * 0.85));
}

// ---------------------------------------------------------------------------
// rasterise
// ---------------------------------------------------------------------------

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const step = 1 / SUPERSAMPLE;

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0, g = 0, b = 0, a = 0, hits = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
      for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
        const colour = shade(px + (sx + 0.5) * step, py + (sy + 0.5) * step);
        hits += 1;
        if (colour) { r += colour[0]; g += colour[1]; b += colour[2]; a += 255; }
      }
    }
    const covered = a / (hits * 255);
    const offset = (py * SIZE + px) * 4;
    // Premultiplied average over covered samples only, so edges do not darken.
    const opaque = Math.max(1, hits * covered);
    pixels[offset] = Math.round(r / opaque);
    pixels[offset + 1] = Math.round(g / opaque);
    pixels[offset + 2] = Math.round(b / opaque);
    pixels[offset + 3] = Math.round(covered * 255);
  }
}

// ---------------------------------------------------------------------------
// encode PNG
// ---------------------------------------------------------------------------

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// Each scanline is prefixed with filter type 0 (none).
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;   // bit depth
header[9] = 6;   // colour type: RGBA
header[10] = 0;  // deflate
header[11] = 0;  // adaptive filtering
header[12] = 0;  // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = new URL('../src-tauri/icons/source.png', import.meta.url);
mkdirSync(dirname(out.pathname), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out.pathname} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} kB)`);
console.log('Now run:  npx tauri icon src-tauri/icons/source.png');
