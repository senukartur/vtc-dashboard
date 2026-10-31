import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import { EventFailure, fail, schema } from "../events/transport.js";
import type { Attempt, DTO } from "./model.js";
export async function notificationRead<
  K extends
    | "EnvelopeNotificationFeed"
    | "EnvelopeListNotification"
    | "EnvelopeNotificationPreferences",
>(path: string, name: K, signal: AbortSignal) {
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
    bounded.throwIfAborted();
    if (!parsed.success) throw new AccountFailure("unavailable");
    return { data: parsed.data.data as DTO[K]["data"], etag: response.headers.get("ETag") };
  } catch (error) {
    throw error instanceof AccountFailure ? error : new AccountFailure("unavailable");
  }
}
export async function notificationCommand<
  K extends "EnvelopeCommandResult" | "EnvelopeNotificationPreferences",
>(
  path: string,
  body: unknown,
  name: K,
  etag: string | null,
  attempt: Attempt,
  signal: AbortSignal,
) {
  try {
    const csrf = await read("/auth/csrf", csrfEnvelope, signal);
    signal.throwIfAborted();
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
    const response = await fetch(`/api/v1${path}`, {
      method: path === "/me/notification-preferences" ? "PUT" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: bounded,
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrf.data.data.token,
        "Idempotency-Key": attempt.key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(etag ? { "If-Match": etag } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status !== 200) fail(response);
    const parsed = schema(name).safeParse(await response.json());
    bounded.throwIfAborted();
    if (!parsed.success) throw new AccountFailure("uncertain");
    if (
      name === "EnvelopeNotificationPreferences" &&
      !/^"[^"\r\n]+"$/.test(response.headers.get("ETag") ?? "")
    )
      throw new AccountFailure("uncertain");
    return { data: parsed.data.data as DTO[K]["data"], etag: response.headers.get("ETag") };
  } catch (error) {
    throw error instanceof AccountFailure ? error : new AccountFailure("uncertain");
  }
}
/** A signed cursor can be invalidated by an access/session epoch, not a clock expiry. */
export async function pollPage(
  cursor: string | null,
  signal: AbortSignal,
  onInvalidated?: () => void,
) {
  try {
    return {
      ...(await notificationRead(
        `/notifications?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        "EnvelopeNotificationFeed",
        signal,
      )),
      rebased: false,
    };
  } catch (error) {
    if (!cursor || !(error instanceof EventFailure) || error.status !== 409) throw error;
    signal.throwIfAborted();
    onInvalidated?.();
    // Exactly one recovery read. A failing fresh baseline never recursively retries.
    return {
      ...(await notificationRead("/notifications?limit=50", "EnvelopeNotificationFeed", signal)),
      rebased: true,
    };
  }
}
