import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      let r = 9;
      let g = 9;
      let b = 11;
      const a = 255;

      const border = nx < 0.06 || nx > 0.94 || ny < 0.06 || ny > 0.94;
      if (border) {
        r = 40;
        g = 120;
        b = 20;
      }

      const d1 = Math.abs(nx - ny);
      const d2 = Math.abs(nx + ny - 1);
      const inBox = nx >= 0.2 && nx <= 0.8 && ny >= 0.2 && ny <= 0.8;
      if (inBox && (d1 < 0.14 || d2 < 0.14)) {
        r = 83;
        g = 252;
        b = 24;
      }

      const off = rowStart + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", zlib.deflateSync(raw)),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconDir = path.resolve("extension", "icons");
fs.mkdirSync(iconDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconDir, `icon${size}.png`), makePng(size));
}
console.log("Generated extension icons:", fs.readdirSync(iconDir));
