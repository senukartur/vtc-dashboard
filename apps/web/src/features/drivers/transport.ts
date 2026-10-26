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

export class DriversFailure extends AccountFailure {
  constructor(
    kind: AccountFailure["kind"],
    public readonly status = 0,
    delay: number | null = null,
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
  throw new DriversFailure(
    kinds[response.status] ?? "uncertain",
    response.status,
    retryDelay(response.headers.get("Retry-After")),
  );
}

export async function driversRead<K extends keyof DTO>(path: string, name: K, signal: AbortSignal) {
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
    if (response.status !== 200) fail(response);
    const parsed = schema(name).safeParse(await response.json());
    if (!parsed.success) throw new DriversFailure("unavailable");
    bounded.throwIfAborted();
    return { data: parsed.data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new DriversFailure("unavailable");
  }
}
