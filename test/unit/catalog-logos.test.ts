import { deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import {
  CATALOG_LOGO_MAX_BYTES,
  CATALOG_LOGO_MAX_HEIGHT,
  CATALOG_LOGO_MAX_WIDTH,
} from "../../apps/api/src/modules/catalogs/config.ts";
import { inspectPng, logoCodeFromName, PngError } from "../../apps/api/src/modules/catalogs/png.ts";
import {
  chunk,
  greyAlphaLogo,
  header,
  jpegLike,
  PNG_SIGNATURE,
  paletteLogo,
  pngFrom,
  rgbaLogo,
  rgbaRaw,
  rowBytes,
} from "../fixtures/catalogs/logos.ts";

const reason = (bytes: Buffer) => {
  try {
    inspectPng(bytes);
  } catch (error) {
    if (error instanceof PngError) return error.reason;
    throw error;
  }
  return "accepted";
};

test("generated logos at and below the limits are accepted without being re-encoded", () => {
  expect(inspectPng(rgbaLogo(1))).toEqual({ width: 128, height: 32 });
  expect(inspectPng(rgbaLogo(2, 20, 8))).toEqual({ width: 20, height: 8 });
  expect(inspectPng(rgbaLogo(3, 1, 1))).toEqual({ width: 1, height: 1 });
  expect(inspectPng(paletteLogo(4))).toEqual({ width: 96, height: 24 });
  expect(inspectPng(greyAlphaLogo(5))).toEqual({ width: 64, height: 16 });
  expect(rgbaLogo(1).length).toBeLessThanOrEqual(CATALOG_LOGO_MAX_BYTES);
});

test("different seeds draw different images, so a replacement changes the stored bytes", () => {
  expect(rgbaLogo(1).equals(rgbaLogo(2))).toBe(false);
  expect(rgbaLogo(1).equals(rgbaLogo(1))).toBe(true);
});

test("non-PNG content is named by its first failing check", () => {
  expect(reason(jpegLike())).toBe("not_png");
  expect(reason(Buffer.from(`GIF89a${"x".repeat(40)}`))).toBe("not_png");
  expect(reason(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe("not_png");
  expect(reason(Buffer.alloc(0))).toBe("corrupt");
  expect(reason(PNG_SIGNATURE.subarray(0, 4))).toBe("not_png");
});

test("size and dimension limits are exact", () => {
  expect(CATALOG_LOGO_MAX_WIDTH).toBe(128);
  expect(CATALOG_LOGO_MAX_HEIGHT).toBe(32);
  expect(reason(rgbaLogo(1, 129, 32))).toBe("bad_dimensions");
  expect(reason(rgbaLogo(1, 128, 33))).toBe("bad_dimensions");
  expect(reason(rgbaLogo(1, 128, 32))).toBe("accepted");
  expect(reason(pngFrom({ width: 0, height: 4, raw: Buffer.alloc(0) }))).toBe("bad_dimensions");
  expect(reason(pngFrom({ width: 4, height: 0, raw: Buffer.alloc(0) }))).toBe("bad_dimensions");
  // Over the byte limit the file is refused before it is read as an image.
  expect(reason(Buffer.concat([rgbaLogo(1), Buffer.alloc(CATALOG_LOGO_MAX_BYTES)]))).toBe(
    "too_large",
  );
  // An image that could never fit is refused by its header, not by inflating it.
  expect(reason(pngFrom({ width: 4_000_000, height: 4_000_000, raw: Buffer.alloc(8) }))).toBe(
    "bad_dimensions",
  );
});

test("truncated, damaged and trailing-byte files are corrupt", () => {
  const good = rgbaLogo(1, 40, 10);
  expect(reason(good.subarray(0, good.length - 5))).toBe("corrupt");
  expect(reason(good.subarray(0, 20))).toBe("corrupt");
  const flipped = Buffer.from(good);
  flipped[good.length - 20] = (flipped[good.length - 20] as number) ^ 0xff;
  expect(reason(flipped)).toBe("corrupt");
  const badHeaderCrc = Buffer.from(good);
  badHeaderCrc[29] = (badHeaderCrc[29] as number) ^ 0x01;
  expect(reason(badHeaderCrc)).toBe("corrupt");
  expect(reason(Buffer.concat([good, Buffer.from("trailing")]))).toBe("corrupt");
  expect(reason(Buffer.concat([good, good]))).toBe("corrupt");
});

test("chunk order and header values are enforced", () => {
  const raw = rgbaRaw(8, 4, 1);
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND");
  const ihdr = chunk("IHDR", header(8, 4));
  // IHDR must come first.
  expect(reason(Buffer.concat([PNG_SIGNATURE, idat, ihdr, iend]))).toBe("corrupt");
  // No image data.
  expect(reason(Buffer.concat([PNG_SIGNATURE, ihdr, iend]))).toBe("corrupt");
  // IEND must exist and close the file.
  expect(reason(Buffer.concat([PNG_SIGNATURE, ihdr, idat]))).toBe("corrupt");
  expect(reason(Buffer.concat([PNG_SIGNATURE, ihdr, iend, idat]))).toBe("corrupt");
  // A second header is not allowed.
  expect(reason(Buffer.concat([PNG_SIGNATURE, ihdr, ihdr, idat, iend]))).toBe("corrupt");
  // Interlaced images are not accepted.
  expect(reason(pngFrom({ width: 8, height: 4, raw, interlace: 1 }))).toBe("corrupt");
  // Unknown colour type or a depth that colour type cannot have.
  expect(reason(pngFrom({ width: 8, height: 4, raw, colour: 5 }))).toBe("corrupt");
  expect(reason(pngFrom({ width: 8, height: 4, raw, colour: 6, depth: 4 }))).toBe("corrupt");
  expect(reason(pngFrom({ width: 8, height: 4, raw, colour: 2, depth: 1 }))).toBe("corrupt");
  // A palette image needs its palette before the data.
  expect(reason(pngFrom({ width: 8, height: 4, raw: Buffer.alloc(36), colour: 3 }))).toBe(
    "corrupt",
  );
  // An unknown critical chunk cannot be shown as written; an ancillary one is harmless.
  expect(reason(pngFrom({ width: 8, height: 4, raw, before: [chunk("ABCD")] }))).toBe("corrupt");
  expect(
    reason(pngFrom({ width: 8, height: 4, raw, before: [chunk("tEXt", Buffer.from("a\0b"))] })),
  ).toBe("accepted");
  // Image data must stay together.
  const half = deflateSync(raw);
  const split = Buffer.concat([
    PNG_SIGNATURE,
    ihdr,
    chunk("IDAT", half.subarray(0, 6)),
    chunk("tEXt", Buffer.from("a\0b")),
    chunk("IDAT", half.subarray(6)),
    iend,
  ]);
  expect(reason(split)).toBe("corrupt");
  const joined = Buffer.concat([
    PNG_SIGNATURE,
    ihdr,
    chunk("IDAT", half.subarray(0, 6)),
    chunk("IDAT", half.subarray(6)),
    iend,
  ]);
  expect(reason(joined)).toBe("accepted");
});

test("image data must inflate to exactly the scanlines the header describes", () => {
  const width = 16,
    height = 8;
  const exact = rgbaRaw(width, height, 3);
  expect(reason(pngFrom({ width, height, raw: exact }))).toBe("accepted");
  // Too short, too long, and far too long (a decompression bomb) are all refused.
  expect(reason(pngFrom({ width, height, raw: exact.subarray(0, exact.length - 1) }))).toBe(
    "corrupt",
  );
  expect(reason(pngFrom({ width, height, raw: Buffer.concat([exact, Buffer.alloc(1)]) }))).toBe(
    "corrupt",
  );
  const bomb = deflateSync(Buffer.alloc(16 * 1024 * 1024));
  expect(bomb.length).toBeLessThan(CATALOG_LOGO_MAX_BYTES);
  expect(reason(pngFrom({ width, height, raw: exact, idat: bomb }))).toBe("corrupt");
  // Not a zlib stream at all.
  expect(reason(pngFrom({ width, height, raw: exact, idat: Buffer.from("not zlib data") }))).toBe(
    "corrupt",
  );
  // A filter byte above 4 does not exist.
  const badFilter = Buffer.from(exact);
  badFilter[(rowBytes(width, 6) + 1) * 3] = 5;
  expect(reason(pngFrom({ width, height, raw: badFilter }))).toBe("corrupt");
});

test("file names must be the company code with a lowercase png extension", () => {
  expect(logoCodeFromName("fictional_co.png")).toBe("fictional_co");
  expect(logoCodeFromName("Fictional-Co.v2.png")).toBe("Fictional-Co.v2");
  expect(logoCodeFromName("ünï_cödé.png")).toBe("ünï_cödé");
  for (const bad of [
    "fictional_co.PNG",
    "fictional_co.Png",
    "fictional_co.jpg",
    "fictional_co",
    "fictional_co.png.exe",
    ".png",
    "",
    "a/b.png",
    "..\\b.png",
    "../b.png",
    "with space.png",
    "tab\t.png",
    `${"x".repeat(129)}.png`,
  ])
    expect(logoCodeFromName(bad), bad).toBeNull();
  expect(logoCodeFromName(`${"x".repeat(128)}.png`)).toBe("x".repeat(128));
});
