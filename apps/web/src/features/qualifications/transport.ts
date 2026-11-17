import type { components } from "@vtc/contracts";
import { browserSchemaDocument } from "@vtc/contracts/runtime";
import { z } from "zod";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import { retryDelay } from "../admissions/transport.js";

export type DTO = components["schemas"];
export type Game = "ets2" | "ats";
export type Level = DTO["QualificationLevelSummary"];
export type LevelDetail = DTO["QualificationLevelDetail"];
export type Limits = DTO["QualificationLimits"];
export type Conditions = DTO["QualificationConditions"];
export type Mine = DTO["MyQualification"];

const schemas = new Map<string, z.ZodType>();
export function schema<K extends keyof DTO>(name: K): z.ZodType<DTO[K]> {
  let result = schemas.get(name);
  if (!result) {
    result = z.fromJSONSchema({ ...browserSchemaDocument, $ref: `#/$defs/${name}` });
    schemas.set(name, result);
  }
  return result as z.ZodType<DTO[K]>;
}
/** A failed qualification read or command; `code` keeps the public error code when one is sent. */
export class QualificationFailure extends AccountFailure {
  constructor(
    kind: AccountFailure["kind"],
    public readonly status = 0,
    delay: number | null = null,
    public readonly code: string | null = null,
    /** The existing level a create or move would leave without conditions, when named. */
    public readonly levelId: string | null = null,
  ) {
    super(kind, delay);
  }
}
const kinds: Record<number, AccountFailure["kind"]> = {
  400: "invalid",
  401: "unauthorized",
  403: "forbidden",
  404: "unavailable",
  409: "conflict",
  413: "invalid",
  415: "invalid",
  422: "invalid",
  429: "limited",
  503: "unavailable",
};
async function failure(response: Response): Promise<QualificationFailure> {
  let code: string | null = null,
    levelId: string | null = null;
  try {
    const parsed = schema("Error").safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.error.code;
      levelId =
        parsed.data.error.details?.find(
          (detail) => detail.code === "QUALIFICATION_CONDITIONS_REQUIRED",
        )?.ownResourceId ?? null;
    }
  } catch {
    // A body that is not the error envelope keeps only the status.
  }
  return new QualificationFailure(
    kinds[response.status] ?? "uncertain",
    response.status,
    retryDelay(response.headers.get("Retry-After")),
    code,
    levelId,
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
    if (response.status !== 200) throw await failure(response);
    const parsed = schema(name).safeParse(await response.json());
    if (!parsed.success) throw new QualificationFailure("unavailable");
    bounded.throwIfAborted();
    return { data: parsed.data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new QualificationFailure("unavailable");
  }
}
/** One qualification command. Version checks live in the body, so a retry is always safe to show. */
export async function qualificationWrite<K extends keyof DTO>(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
  name: K,
  signal: AbortSignal,
): Promise<DTO[K]> {
  try {
    const csrf = await read("/auth/csrf", csrfEnvelope, signal);
    const response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf.data.data.token,
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 200 && response.status !== 201) throw await failure(response);
    const parsed = schema(name).safeParse(await response.json());
    if (!parsed.success) throw new QualificationFailure("uncertain");
    return parsed.data;
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new QualificationFailure("uncertain");
  }
}
