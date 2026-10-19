import type { ApplicationInput } from "./schema.js";
import { csrfEnvelope, receiptEnvelope } from "./schema.js";
export type SubmissionFailure =
  | "invalid"
  | "forbidden"
  | "conflict"
  | "limited"
  | "unavailable"
  | "uncertain";
export class ApplicationFailure extends Error {
  constructor(
    public readonly kind: SubmissionFailure,
    public readonly retryAfter: number | null = null,
  ) {
    super("APPLICATION_SUBMISSION_FAILED");
  }
}
export function retryDelay(value: string | null): number | null {
  if (!value || !/^\d{1,6}$/.test(value)) return null;
  const seconds = Number(value);
  return seconds > 0 ? Math.min(seconds, 3600) : null;
}
function failed(response: Response): never {
  const kind = (
    {
      422: "invalid",
      403: "forbidden",
      409: "conflict",
      429: "limited",
      503: "unavailable",
      404: "unavailable",
    } as const
  )[response.status as 422];
  throw new ApplicationFailure(
    kind ?? "uncertain",
    response.status === 429 ? retryDelay(response.headers.get("Retry-After")) : null,
  );
}
/** One user action makes one POST. Uncertain attempts remain discoverable with their original key. */
export async function submitApplication(
  payload: ApplicationInput,
  key: string,
  locale: "ru" | "en",
  signal: AbortSignal,
): Promise<void> {
  try {
    const response = await fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) failed(response);
    const csrf = csrfEnvelope.safeParse(await response.json());
    if (!csrf.success) throw new ApplicationFailure("uncertain");
    const result = await fetch("/api/v1/public/applications", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRF-Token": csrf.data.data.token,
        "Idempotency-Key": key,
        "Accept-Language": locale,
      },
      body: JSON.stringify(payload),
    });
    if (result.status !== 201) failed(result);
    if (!receiptEnvelope.safeParse(await result.json()).success)
      throw new ApplicationFailure("uncertain");
  } catch (error) {
    if (error instanceof ApplicationFailure) throw error;
    throw new ApplicationFailure("uncertain");
  }
}
export interface SubmissionAttempt {
  serialized: string;
  payload: ApplicationInput;
  key: string;
  locale: "ru" | "en";
}
export function submissionAttempt(
  payload: ApplicationInput,
  locale: "ru" | "en",
  previous: SubmissionAttempt | null,
  createKey: () => string = () => crypto.randomUUID(),
): SubmissionAttempt {
  const serialized = JSON.stringify(payload);
  return previous?.serialized === serialized
    ? previous
    : { serialized, payload, key: createKey(), locale };
}
