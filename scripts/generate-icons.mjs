import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
mkdirSync(assetsDir, { recursive: true });

// Precompute CRC32 lookup table for PNG chunk checksums
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBytes = Buffer.alloc(4);
  lenBytes.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBytes, typeBytes, data, crcBytes]);
}

function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // None filter
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function blendPixel(buf, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
  const idx = (y * size + x) * 4;
  const srcA = a / 255;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
  buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
  buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function roundedRectCoverage(nx, ny, halfW, halfH, radius) {
  const dx = Math.max(Math.abs(nx) - (halfW - radius), 0);
  const dy = Math.max(Math.abs(ny) - (halfH - radius), 0);
  const dist = Math.hypot(dx, dy) - radius;
  return Math.max(0, Math.min(1, 0.5 - dist));
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const scale = size / 64;
  const half = size * 0.44;
  const radius = size * 0.21;

  // Background obsidian rounded square + subtle cyan/indigo border glow
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cx = x + 0.5 - size / 2;
      const cy = y + 0.5 - size / 2;
      const cov = roundedRectCoverage(cx, cy, half, half, radius);
      if (cov <= 0) continue;

      const t = (x + y) / (2 * size);
      const bgR = Math.round(11 + t * 8);
      const bgG = Math.round(16 + t * 10);
      const bgB = Math.round(28 + t * 14);
      blendPixel(buf, size, x, y, bgR, bgG, bgB, Math.round(cov * 255));

      const innerCov = roundedRectCoverage(cx, cy, half - 1.5 * scale, half - 1.5 * scale, Math.max(1, radius - 1.5 * scale));
      const borderAlpha = Math.max(0, cov - innerCov);
      if (borderAlpha > 0) {
        blendPixel(buf, size, x, y, 56, 189, 248, Math.round(borderAlpha * 170));
      }
    }
  }

  // Four stacked provider usage pills (Claude amber, Antigravity cyan, Gemini blue, Codex emerald)
  const bars = [
    { yNorm: 0.24, fill: 0.78, color: [217, 119, 87] },
    { yNorm: 0.40, fill: 0.62, color: [56, 189, 248] },
    { yNorm: 0.56, fill: 0.48, color: [66, 133, 244] },
    { yNorm: 0.72, fill: 0.86, color: [16, 185, 129] }
  ];

  const trackLeft = size * 0.21;
  const trackWidth = size * 0.58;
  const barHeight = Math.max(2.5, size * 0.085);

  for (const bar of bars) {
    const centerY = size * bar.yNorm;
    const fillWidth = trackWidth * bar.fill;
    for (let y = Math.floor(centerY - barHeight); y <= Math.ceil(centerY + barHeight); y += 1) {
      for (let x = Math.floor(trackLeft - 2); x <= Math.ceil(trackLeft + trackWidth + 2); x += 1) {
        const trackCx = x + 0.5 - (trackLeft + trackWidth / 2);
        const trackCy = y + 0.5 - centerY;
        const trackCov = roundedRectCoverage(trackCx, trackCy, trackWidth / 2, barHeight / 2, barHeight / 2);
        if (trackCov > 0) {
          blendPixel(buf, size, x, y, 36, 48, 72, Math.round(trackCov * 220));
        }

        const fillCx = x + 0.5 - (trackLeft + fillWidth / 2);
        const fillCov = roundedRectCoverage(fillCx, trackCy, fillWidth / 2, barHeight / 2, barHeight / 2);
        if (fillCov > 0) {
          blendPixel(buf, size, x, y, bar.color[0], bar.color[1], bar.color[2], Math.round(fillCov * 255));
        }
      }
    }
  }

  return encodeRgbaPng(size, size, buf);
}

writeFileSync(path.join(assetsDir, 'icon.png'), renderIcon(256));
writeFileSync(path.join(assetsDir, 'tray-icon.png'), renderIcon(32));
console.log('Generated assets/icon.png (256x256) and assets/tray-icon.png (32x32)');
