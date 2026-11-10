import { crc32, inflateSync } from "node:zlib";
import {
  CATALOG_LOGO_MAX_BYTES,
  CATALOG_LOGO_MAX_HEIGHT,
  CATALOG_LOGO_MAX_WIDTH,
  validCode,
} from "./config.js";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Allowed bit depths per colour type, and the samples each pixel carries.
const depths: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const samples: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type PngReason = "not_png" | "too_large" | "bad_dimensions" | "corrupt";
export class PngError extends Error {
  constructor(readonly reason: PngReason) {
    super(reason);
    this.name = "PngError";
  }
}

export interface PngInfo {
  width: number;
  height: number;
}

/**
 * Strictly checks a PNG without a native decoder: signature, chunk order and CRCs, the
 * image header, dimensions, and a bounded inflate that must match the scanline layout.
 * The original bytes are what gets stored; nothing is re-encoded.
 */
export function inspectPng(bytes: Buffer): PngInfo {
  if (bytes.length === 0) throw new PngError("corrupt");
  if (bytes.length > CATALOG_LOGO_MAX_BYTES) throw new PngError("too_large");
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature))
    throw new PngError("not_png");
  const corrupt = () => new PngError("corrupt");
  let offset = signature.length;
  let header: { width: number; height: number; depth: number; type: number } | undefined;
  let palette = 0;
  let sawData = false;
  let dataClosed = false;
  let sawEnd = false;
  const data: Buffer[] = [];
  for (let index = 0; !sawEnd; index++) {
    if (offset + 12 > bytes.length) throw corrupt();
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (length > bytes.length || end + 4 > bytes.length) throw corrupt();
    if (!/^[A-Za-z]{4}$/.test(type)) throw corrupt();
    const body = bytes.subarray(offset + 8, end);
    if (crc32(bytes.subarray(offset + 4, end)) !== bytes.readUInt32BE(end)) throw corrupt();
    offset = end + 4;
    if (index === 0) {
      if (type !== "IHDR" || length !== 13) throw corrupt();
      const width = body.readUInt32BE(0),
        height = body.readUInt32BE(4);
      const depth = body.readUInt8(8),
        colour = body.readUInt8(9);
      if (!depths[colour]?.includes(depth)) throw corrupt();
      if (body.readUInt8(10) !== 0 || body.readUInt8(11) !== 0 || body.readUInt8(12) !== 0)
        throw corrupt();
      if (
        width < 1 ||
        height < 1 ||
        width > CATALOG_LOGO_MAX_WIDTH ||
        height > CATALOG_LOGO_MAX_HEIGHT
      )
        throw new PngError("bad_dimensions");
      header = { width, height, depth, type: colour };
      continue;
    }
    if (!header) throw corrupt();
    if (type === "IHDR") throw corrupt();
    if (type === "IDAT") {
      if (dataClosed || (header.type === 3 && palette === 0)) throw corrupt();
      sawData = true;
      data.push(body);
      continue;
    }
    if (sawData) dataClosed = true;
    if (type === "PLTE") {
      const entries = length / 3;
      if (sawData || palette !== 0 || header.type === 0 || header.type === 4) throw corrupt();
      if (!Number.isInteger(entries) || entries < 1 || entries > 2 ** header.depth) throw corrupt();
      if (header.type === 3 && entries > 256) throw corrupt();
      palette = entries;
      continue;
    }
    if (type === "IEND") {
      if (length !== 0 || !sawData) throw corrupt();
      sawEnd = true;
      continue;
    }
    // An unknown critical chunk means the file cannot be shown as written.
    if (type.charCodeAt(0) < 0x61) throw corrupt();
  }
  if (!header || offset !== bytes.length) throw corrupt();
  const rowBytes = Math.ceil((header.width * (samples[header.type] ?? 0) * header.depth) / 8);
  const expected = header.height * (1 + rowBytes);
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  } catch {
    throw corrupt();
  }
  if (raw.length !== expected) throw corrupt();
  for (let row = 0; row < header.height; row++)
    if ((raw[row * (1 + rowBytes)] as number) > 4) throw corrupt();
  return { width: header.width, height: header.height };
}

/** The company code in `<code>.png` (lowercase extension, catalog-valid code, never a path), or null. */
export function logoCodeFromName(name: string): string | null {
  if (!name.endsWith(".png")) return null;
  const code = name.slice(0, -4);
  return code.includes("/") || code.includes("\\") || !validCode(code) ? null : code;
}
