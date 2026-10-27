import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure } from "../account/transport.js";
import { retryDelay } from "../admissions/transport.js";
import { schema } from "../dashboard/transport.js";
import type { DTO } from "./model.js";
export { schema };
export class EventFailure extends AccountFailure {
  constructor(
    public readonly status: number,
    delay: number | null = null,
  ) {
    const kinds: Record<number, AccountFailure["kind"]> = {
      400: "invalid",
      401: "unauthorized",
      403: "forbidden",
      404: "unavailable",
      409: "conflict",
      412: "conflict",
      422: "invalid",
      428: "conflict",
      429: "limited",
      503: "unavailable",
    };
    super(kinds[status] ?? "uncertain", delay);
  }
}
export function fail(response: Response): never {
  throw new EventFailure(response.status, retryDelay(response.headers.get("Retry-After")));
}
export async function eventRead<K extends keyof DTO>(path: string, name: K, signal: AbortSignal) {
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
    if (!parsed.success) throw new AccountFailure("unavailable");
    bounded.throwIfAborted();
    return { data: parsed.data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("unavailable");
  }
}
