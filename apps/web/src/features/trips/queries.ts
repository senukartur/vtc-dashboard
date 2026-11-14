import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { refreshWorkspaceSummary } from "../../app/workspace-summary.js";
import { keepPreviousPage } from "../../shared/paging.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import {
  type Attempt,
  attemptFor,
  commandAffects,
  type DTO,
  fail,
  schema,
  tripRead,
} from "./transport.js";
/** Index of the request path in the trip query key; `commandAffects` reads the same slot. */
const pathIndex = 6;
/**
 * `keepPage` keeps the previous page's rows (as placeholder data) while another page or sort
 * (`cursor`, `order`) of the same list loads. Another tab, scope or filter, and any identity,
 * capability or language change, show the loading skeleton instead.
 */
export function useTripQuery<K extends keyof DTO>(
  path: string,
  name: K,
  enabled = true,
  poll = false,
  keepPage = false,
) {
  const session = useSession(),
    client = useQueryClient(),
    { i18n } = useTranslation();
  const queryKey = [
    "trip-workspace",
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
    i18n.resolvedLanguage,
    path,
    name,
  ];
  const query = useQuery({
    queryKey,
    meta: { private: true },
    enabled,
    ...(keepPage
      ? { placeholderData: keepPreviousPage(queryKey, pathIndex, ["cursor", "order"]) }
      : {}),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      try {
        return await tripRead(path, name, signal);
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (query) => query.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
    refetchInterval: (q) =>
      poll &&
      !q.state.error &&
      document.visibilityState === "visible" &&
      navigator.onLine &&
      (q.state.data?.data as { data?: { state?: string } } | undefined)?.data?.state ===
        "processing"
        ? 1500
        : false,
    refetchIntervalInBackground: false,
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
export function useTripCommand(onConflict?: () => void) {
  const session = useSession(),
    client = useQueryClient(),
    active = useRef(true),
    controller = useRef<AbortController | null>(null),
    attempt = useRef<Attempt | null>(null);
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
    return () => clearInterval(timer);
  }, [waitUntil]);
  async function run<K extends keyof DTO>(
    path: string,
    body: unknown,
    name: K,
    etag?: string | null,
    method: "POST" | "PUT" | "DELETE" = "POST",
    fingerprint?: string,
  ): Promise<{ data: DTO[K]; etag: string | null } | undefined> {
    if (!active.current || controller.current || waitUntil > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setFailure(null);
    const timeout = window.setTimeout(() => ctl.abort(), 15000);
    attempt.current = attemptFor(
      JSON.stringify([method, path, etag, fingerprint ?? body]),
      attempt.current,
    );
    try {
      const csrf = await read("/auth/csrf", csrfEnvelope, ctl.signal);
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        signal: ctl.signal,
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrf.data.data.token,
          "Idempotency-Key": attempt.current.key,
          ...(body === undefined || body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...(etag ? { "If-Match": etag } : {}),
        },
        ...(body === undefined
          ? {}
          : { body: body instanceof FormData ? body : JSON.stringify(body) }),
      });
      if (![200, 201, 202].includes(response.status)) fail(response);
      const parsed = schema(name).safeParse(await response.json());
      if (!parsed.success) throw new AccountFailure("uncertain");
      attempt.current = null;
      if (active.current) {
        if (path !== "/evidence")
          void refreshWorkspaceSummary(client, session).catch(() => undefined);
        await client.invalidateQueries({
          queryKey: ["trip-workspace"],
          predicate: (query) => commandAffects(path, String(query.queryKey[pathIndex] ?? "")),
        });
        return { data: parsed.data, etag: response.headers.get("ETag") };
      }
    } catch (error) {
      const safe = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
      if (active.current) {
        setFailure(safe);
        if (safe.kind === "unauthorized") await session.confirmSessionLoss(ctl.signal);
        if (safe.kind === "forbidden") {
          client.removeQueries({
            type: "inactive",
            predicate: (query) => query.meta?.private === true,
          });
          await session.refresh();
        }
        if (safe.retryAfter) {
          setWaitUntil(Date.now() + safe.retryAfter * 1000);
          setNow(Date.now());
        }
        if (safe.kind === "conflict") {
          onConflict?.();
          await client.invalidateQueries({
            queryKey: ["trip-workspace"],
            predicate: (query) => commandAffects(path, String(query.queryKey[pathIndex] ?? "")),
          });
        }
        if (!["uncertain", "unavailable", "limited"].includes(safe.kind)) attempt.current = null;
      }
    } finally {
      clearTimeout(timeout);
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
