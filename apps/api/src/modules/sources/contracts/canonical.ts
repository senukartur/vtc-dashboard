import { createHash } from "node:crypto";

function unicode(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("INVALID_JSON_UNICODE");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error("INVALID_JSON_UNICODE");
  }
  return value;
}
// RFC 8785: direct entry serialization also preserves sorted integer-looking object keys.
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 16) throw new Error("INVALID_JSON_DEPTH");
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(unicode(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new Error("INVALID_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error("INVALID_JSON_ARRAY");
    const items: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new Error("INVALID_JSON_ARRAY");
      items.push(canonicalJson(descriptor.value, depth + 1));
    }
    return `[${items.join(",")}]`;
  }
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error("INVALID_JSON_OBJECT");
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !("value" in (Object.getOwnPropertyDescriptor(value, key) ?? {})),
    )
  )
    throw new Error("INVALID_JSON_PROPERTY");
  return `{${(keys as string[])
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(unicode(key))}:${canonicalJson((value as Record<string, unknown>)[key], depth + 1)}`,
    )
    .join(",")}}`;
}
export const contentHash = (canonical: string) => createHash("sha256").update(canonical).digest();
export const sourceKey = (value: string) => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new Error("INVALID_SOURCE_KEY");
  return Buffer.from(value, "ascii");
};

export function decimal(value: number | string): string {
  if (typeof value === "string") {
    // Controlled text uses bounded decimal spelling; only IEEE numbers need exponent expansion.
    if (value.length > 39 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
      throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  } else if (!Number.isFinite(value) || value < 0) {
    throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  }
  let text = String(value);
  if (typeof value === "number" && text.includes("e")) {
    const [mantissa = "", power = "0"] = text.split("e");
    const [whole = "", fraction = ""] = mantissa.split(".");
    const digits = whole + fraction,
      position = whole.length + Number(power);
    text =
      position <= 0
        ? `0.${"0".repeat(-position)}${digits}`
        : position >= digits.length
          ? digits + "0".repeat(position - digits.length)
          : `${digits.slice(0, position)}.${digits.slice(position)}`;
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) throw new Error("INVALID_NONNEGATIVE_DECIMAL");
  const [whole = "", fraction = ""] = text.split(".");
  if (whole.length > 20 || fraction.length > 18) throw new Error("DECIMAL_PRECISION_EXCEEDED");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}
