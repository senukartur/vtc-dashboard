import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

// Original fictional marks drawn pixel by pixel at test time. No game artwork, real company logo
// or binary file is committed; every byte below is computed from these shapes.
export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function chunk(type: string, body: Buffer = Buffer.alloc(0)) {
  const name = Buffer.from(type, "latin1");
  const result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length);
  name.copy(result, 4);
  body.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, body])), body.length + 8);
  return result;
}

export function header(width: number, height: number, depth = 8, colour = 6, interlace = 0) {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(width);
  body.writeUInt32BE(height, 4);
  body[8] = depth;
  body[9] = colour;
  body[12] = interlace;
  return body;
}

const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** Bytes per scanline without the filter byte. */
export const rowBytes = (width: number, colour: number, depth = 8) =>
  Math.ceil((width * (channels[colour] as number) * depth) / 8);

/** A deterministic mark: a coloured bar with a diamond cut out, varied by `seed`. */
function paint(width: number, height: number, seed: number) {
  const inside = (x: number, y: number) => {
    const bar =
      y >= Math.floor(height * 0.2) && y < Math.ceil(height * 0.8) && x >= 2 && x < width - 2;
    const cx = Math.floor(width * (0.25 + 0.5 * ((seed % 5) / 5))),
      cy = Math.floor(height / 2),
      reach = Math.max(2, Math.floor(height / 3));
    const diamond = Math.abs(x - cx) + Math.abs(y - cy) < reach;
    return { bar, diamond };
  };
  return inside;
}

/** An 8-bit RGBA image: transparent ground, a seed-coloured bar and a white diamond. */
export function rgbaRaw(width: number, height: number, seed = 1) {
  const inside = paint(width, height, seed);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (width * 4 + 1);
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      const { bar, diamond } = inside(x, y);
      const at = base + 1 + x * 4;
      if (diamond && bar) raw.set([255, 255, 255, 255], at);
      else if (bar)
        raw.set([(seed * 53) % 256, (seed * 97 + 40) % 256, (seed * 29 + 120) % 256, 255], at);
    }
  }
  return raw;
}

export function pngFrom(parts: {
  width: number;
  height: number;
  raw: Buffer;
  colour?: number;
  depth?: number;
  interlace?: number;
  palette?: Buffer;
  before?: Buffer[];
  after?: Buffer[];
  idat?: Buffer;
  trailing?: Buffer;
}) {
  const colour = parts.colour ?? 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk(
      "IHDR",
      header(parts.width, parts.height, parts.depth ?? 8, colour, parts.interlace ?? 0),
    ),
    ...(parts.palette ? [chunk("PLTE", parts.palette)] : []),
    ...(parts.before ?? []),
    chunk("IDAT", parts.idat ?? deflateSync(parts.raw)),
    ...(parts.after ?? []),
    chunk("IEND"),
    ...(parts.trailing ? [parts.trailing] : []),
  ]);
}

/** A valid RGBA logo; the default is the largest accepted size. */
export function rgbaLogo(seed = 1, width = 128, height = 32) {
  return pngFrom({ width, height, raw: rgbaRaw(width, height, seed) });
}

/** A valid 8-bit palette logo with three colours. */
export function paletteLogo(seed = 1, width = 96, height = 24) {
  const inside = paint(width, height, seed);
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const { bar, diamond } = inside(x, y);
      raw[y * (width + 1) + 1 + x] = diamond && bar ? 2 : bar ? 1 : 0;
    }
  const palette = Buffer.from([0, 0, 0, (seed * 41) % 256, 90, 160, 255, 255, 255]);
  return pngFrom({ width, height, raw, colour: 3, palette });
}

/** A valid 2-channel (grey + alpha) logo. */
export function greyAlphaLogo(seed = 1, width = 64, height = 16) {
  const raw = Buffer.alloc((width * 2 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      raw.set([((x + seed) * 7) % 256, x < width / 2 ? 255 : 128], y * (width * 2 + 1) + 1 + x * 2);
  return pngFrom({ width, height, raw, colour: 4 });
}

export const sha256Hex = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** A JPEG start-of-image marker with filler: enough to prove a non-PNG is refused. */
export const jpegLike = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
