import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, body: Buffer) {
  const type = Buffer.from(name),
    result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length);
  type.copy(result, 4);
  body.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([type, body])), body.length + 8);
  return result;
}
// Original generated test pixels; no game image or member screenshot is used.
export function pngBytes(width = 2, height = 2, channels: 1 | 2 | 3 | 4 = 3) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = ({ 1: 0, 2: 4, 3: 2, 4: 6 } as const)[channels];
  const rows = Buffer.alloc((width * channels + 1) * height);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
