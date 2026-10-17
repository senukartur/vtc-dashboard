import { randomUUID } from "node:crypto";
import { customType } from "drizzle-orm/mysql-core";

export function applicationId(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    throw new Error("INVALID_APPLICATION_ID");
  }
  return value;
}

export const newId = (): string => randomUUID();

export function opaqueBytes(value: Uint8Array, maxLength = 512): Buffer {
  if (
    !Number.isInteger(maxLength) ||
    maxLength < 1 ||
    maxLength > 512 ||
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > maxLength
  ) {
    throw new Error("INVALID_OPAQUE_BYTES");
  }
  return Buffer.from(value);
}

export function opaqueUtf8(value: string, maxLength = 512): Buffer {
  if (typeof value !== "string") throw new Error("INVALID_OPAQUE_TEXT");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.toString("utf8") !== value) throw new Error("INVALID_OPAQUE_TEXT");
  return opaqueBytes(bytes, maxLength);
}

export function decimal38_18(value: string): string {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new Error("INVALID_DECIMAL");
  }
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
  if (!integer || integer.length > 20 || fraction.length > 18) {
    throw new Error("DECIMAL_PRECISION_EXCEEDED");
  }
  return value;
}

export function signedBigint(value: string): string {
  if (typeof value !== "string" || !/^(0|-?[1-9]\d*)$/.test(value)) {
    throw new Error("INVALID_BIGINT");
  }
  const parsed = BigInt(value);
  if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) {
    throw new Error("BIGINT_RANGE_EXCEEDED");
  }
  return value;
}

// Inputs must carry an explicit offset. Never interpret a local wall clock as UTC.
export function utcDateTime(value: string | Date): string {
  if (typeof value === "string") {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
        value,
      );
    if (!match) throw new Error("INVALID_UTC_INSTANT");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > lastDay ||
      Number(match[4]) > 23 ||
      Number(match[5]) > 59 ||
      Number(match[6]) > 59
    ) {
      throw new Error("INVALID_UTC_INSTANT");
    }
  } else if (!(value instanceof Date)) {
    throw new Error("INVALID_UTC_INSTANT");
  }
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1000 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new Error("INVALID_UTC_INSTANT");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function utcIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) {
    throw new Error("INVALID_STORED_UTC");
  }
  const iso = `${value.replace(" ", "T")}Z`;
  if (utcDateTime(iso) !== value) throw new Error("INVALID_STORED_UTC");
  return iso;
}

export const idColumn = customType<{ data: string; driverData: Buffer }>({
  dataType: () => "binary(36)",
  toDriver: (value) => Buffer.from(applicationId(value), "ascii"),
  fromDriver: (value) => applicationId(value.toString("utf8")),
});

export function opaqueColumn(name: string, config: { length: number }) {
  const length = config.length;
  if (!Number.isInteger(length) || length < 1 || length > 512) {
    throw new Error("INVALID_OPAQUE_COLUMN_LENGTH");
  }
  return customType<{ data: Buffer; driverData: Buffer }>({
    dataType: () => `varbinary(${length})`,
    toDriver: (value) => opaqueBytes(value, length),
    fromDriver: (value) => opaqueBytes(value, length),
  })(name);
}

export const decimalColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "decimal(38,18)",
  toDriver: decimal38_18,
  fromDriver: decimal38_18,
});

export const bigintColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "bigint",
  toDriver: signedBigint,
  fromDriver: signedBigint,
});

// Repositories pass canonical UTC ISO strings; reads return canonical UTC ISO strings.
export const utcColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "datetime(3)",
  toDriver: utcDateTime,
  fromDriver: utcIso,
});
