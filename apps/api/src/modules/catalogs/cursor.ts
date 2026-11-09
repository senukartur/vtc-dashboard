import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function ordered(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(ordered).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${ordered(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Signed opaque tokens bound to `binding`; used for list cursors and import dry-run tokens. */
export function cursorCodec(key: string) {
  const sign = (s: string) =>
    createHmac("sha256", Buffer.from(key, "hex")).update("catalogs/cursor/v2\0").update(s).digest();
  return {
    write(binding: unknown, after: string) {
      const data = Buffer.from(JSON.stringify({ binding: hash(ordered(binding)), after })).toString(
        "base64url",
      );
      return `${data}.${sign(data).toString("base64url")}`;
    },
    read(binding: unknown, token: string) {
      if (token.length > 2048) throw new Error("INVALID_CURSOR");
      const [data, mac, extra] = token.split(".");
      if (!data || !mac || extra) throw new Error("INVALID_CURSOR");
      const supplied = Buffer.from(mac, "base64url"),
        expected = sign(data);
      if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied))
        throw new Error("INVALID_CURSOR");
      const parsed = z
        .strictObject({ binding: z.string(), after: z.string().max(1024) })
        .parse(JSON.parse(Buffer.from(data, "base64url").toString()));
      if (parsed.binding !== hash(ordered(binding))) throw new Error("INVALID_CURSOR");
      return parsed.after;
    },
  };
}
