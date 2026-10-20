import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useSession } from "../../app/Session.js";
import { envelope } from "../../shared/catalog-selectors/contracts.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import { retryDelay } from "../admissions/transport.js";
import { type CatalogAttempt, catalogAttempt } from "./transport.js";

// Commands retain a key only in this short-lived closure; uploaded bytes never enter query history/storage.
export function useCatalogCommand() {
  const session = useSession(),
    active = useRef(true),
    attempt = useRef<CatalogAttempt | null>(null),
    controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<AccountFailure | null>(null),
    [waitUntil, setWaitUntil] = useState(0),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      attempt.current = null;
    };
  }, []);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);
  async function run<T extends z.ZodType>(
    path: string,
    body: unknown,
    schema: T,
    etag?: string,
    fingerprint?: string,
  ): Promise<z.output<T> | undefined> {
    if (controller.current || waitUntil > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setFailure(null);
    const timer = window.setTimeout(() => ctl.abort(), 15000);
    attempt.current = catalogAttempt(
      fingerprint ?? JSON.stringify([path, body, etag]),
      attempt.current,
    );
    try {
      const csrf = await read("/auth/csrf", csrfEnvelope, ctl.signal);
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: ctl.signal,
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrf.data.data.token,
          "Idempotency-Key": attempt.current.key,
          ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...(etag ? { "If-Match": etag } : {}),
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      if (![200, 201, 202].includes(response.status)) {
        const map: Record<number, AccountFailure["kind"]> = {
          400: "invalid",
          401: "unauthorized",
          403: "forbidden",
          404: "unavailable",
          409: "conflict",
          413: "invalid",
          415: "invalid",
          422: "invalid",
          428: "conflict",
          429: "limited",
          503: "unavailable",
        };
        throw new AccountFailure(
          map[response.status] ?? "uncertain",
          retryDelay(response.headers.get("Retry-After")),
        );
      }
      const result = envelope(schema).safeParse(await response.json());
      if (!result.success) throw new AccountFailure("uncertain");
      attempt.current = null;
      if (active.current) return result.data.data as z.output<T>;
    } catch (error) {
      const safe = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
      if (active.current) {
        setFailure(safe);
        if (safe.kind === "unauthorized") await session.confirmSessionLoss(ctl.signal);
        if (safe.kind === "forbidden") await session.refresh();
        if (safe.retryAfter) {
          setWaitUntil(Date.now() + safe.retryAfter * 1000);
          setNow(Date.now());
        }
        if (!["uncertain", "unavailable", "limited"].includes(safe.kind)) attempt.current = null;
      }
    } finally {
      window.clearTimeout(timer);
      controller.current = null;
      if (active.current) setPending(false);
    }
  }
  return {
    run,
    pending,
    failure,
    seconds: Math.max(0, Math.ceil((waitUntil - now) / 1000)),
    reset: () => {
      attempt.current = null;
      setFailure(null);
    },
  };
}
