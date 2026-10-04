// Generates the scout app's Home Screen icons (gold lightning bolt on navy).
// Run: npm run icons   — writes scout-app/icons/*.png. No dependencies.
// iOS needs PNG (not SVG) for apple-touch-icon, hence this little rasterizer.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../scout-app/icons/', import.meta.url);

// Bolt outline in unit coordinates, scaled to 72% so it sits inside the
// "maskable" safe zone (Android crops icons to a circle).
const BOLT = [[0.60, 0.06], [0.24, 0.56], [0.47, 0.56], [0.38, 0.94], [0.77, 0.40], [0.54, 0.40], [0.66, 0.06]]
  .map(([x, y]) => [0.5 + (x - 0.5) * 0.72, 0.5 + (y - 0.5) * 0.72]);

function inPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function pixel(u, v) {
  // Navy diagonal gradient with an electric-blue glow behind the bolt.
  let c = mix([0, 0, 0x33], [0, 0, 0x80], (u + v) / 2);
  const d = Math.hypot(u - 0.5, v - 0.5);
  c = mix(c, [0x00, 0x55, 0xff], Math.max(0, 0.45 - d) * 1.1);
  return c;
}

function render(size) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const gold = [0xff, 0xd7, 0x00];
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0 + RGB
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          const c = inPolygon(u, v, BOLT) ? gold : pixel(u, v);
          acc = acc.map((a, i) => a + c[i]);
        }
      }
      for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(acc[i] / (SS * SS));
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(new URL(name, OUT), render(size));
  console.log(`wrote scout-app/icons/${name} (${size}x${size})`);
}
