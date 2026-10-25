import type { components } from "@vtc/contracts";
import { browserSchemaDocument } from "@vtc/contracts/runtime";
import { z } from "zod";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure } from "../account/transport.js";
import { retryDelay } from "../admissions/transport.js";
export type DTO = components["schemas"];
const schemas = new Map<string, z.ZodType>();
export function schema<K extends keyof DTO>(name: K): z.ZodType<DTO[K]> {
  let result = schemas.get(name);
  if (!result) {
    result = z.fromJSONSchema({ ...browserSchemaDocument, $ref: `#/$defs/${name}` });
    schemas.set(name, result);
  }
  return result as z.ZodType<DTO[K]>;
}
export class QualificationFailure extends AccountFailure {
  constructor(
    kind: AccountFailure["kind"],
    public readonly status = 0,
    delay: number | null = null,
    public readonly setupRequired = false,
  ) {
    super(kind, delay);
  }
}
export function fail(response: Response): never {
  const kinds: Record<number, AccountFailure["kind"]> = {
    400: "invalid",
    401: "unauthorized",
    403: "forbidden",
    404: "unavailable",
    409: "conflict",
    410: "unavailable",
    413: "invalid",
    415: "invalid",
    422: "invalid",
    428: "conflict",
    429: "limited",
    503: "unavailable",
  };
  throw new QualificationFailure(
    kinds[response.status] ?? "uncertain",
    response.status,
    retryDelay(response.headers.get("Retry-After")),
  );
}
export async function qualificationRead<K extends keyof DTO>(
  path: string,
  name: K,
  signal: AbortSignal,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    const response = await withReadSlot(bounded, () =>
      fetch(`/api/v1${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: bounded,
        headers: { Accept: "application/json" },
      }),
    );
    if (response.status === 409) {
      const safe = schema("Error").safeParse(await response.json());
      if (safe.success && safe.data.error.code === "SETUP_REQUIRED")
        throw new QualificationFailure("conflict", 409, null, true);
    }
    if (response.status !== 200) fail(response);
    const parsed = schema(name).safeParse(await response.json());
    if (!parsed.success) throw new QualificationFailure("unavailable");
    bounded.throwIfAborted();
    return { data: parsed.data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new QualificationFailure("unavailable");
  }
}
export type Attempt = { fingerprint: string; key: string; etag: string | null };
export function attemptFor(
  fingerprint: string,
  etag: string | null,
  previous: Attempt | null,
): Attempt {
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, key: crypto.randomUUID(), etag };
}
export type Game = "ets2" | "ats";
export const levelOrder = ["trainee", "driver_iii", "driver_ii", "driver_i"] as const;
export function exactInput(value: string): string | undefined {
  const clean = value.trim().replace(",", ".");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(clean)) return undefined;
  const [whole, fraction = ""] = clean.split(".");
  if ((whole?.length ?? 0) > 20 || fraction.length > 18) return undefined;
  return clean.includes(".") ? clean.replace(/0+$/, "").replace(/\.$/, "") : clean;
}
export function countInput(value: string): number | null | undefined {
  if (value.trim() === "") return null;
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= 2147483647 ? n : undefined;
}
export function utcInput(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const canonical = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(3, "0")}Z`;
  const ms = Date.parse(canonical);
  return Number.isFinite(ms) && new Date(ms).toISOString() === canonical ? canonical : undefined;
}
