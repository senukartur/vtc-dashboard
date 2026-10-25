import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import {
  type Attempt,
  attemptFor,
  type DTO,
  fail,
  qualificationRead,
  schema,
} from "./transport.js";
export function useQualificationQuery<K extends keyof DTO>(path: string, name: K, enabled = true) {
  const session = useSession(),
    client = useQueryClient(),
    { i18n } = useTranslation();
  const query = useQuery({
    queryKey: [
      "qualification-workspace",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
      i18n.resolvedLanguage,
      path,
      name,
    ],
    meta: { private: true },
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      try {
        return await qualificationRead(path, name, signal);
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
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
export function useQualificationCommand() {
  const session = useSession(),
    client = useQueryClient(),
    active = useRef(true),
    controller = useRef<AbortController | null>(null),
    attempt = useRef<Attempt | null>(null),
    request = useRef<{
      path: string;
      body: unknown;
      name: keyof DTO;
      etag: string | null | undefined;
      method: "POST" | "PATCH";
      fingerprint: string | undefined;
    } | null>(null);
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
      request.current = null;
    };
  }, []);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= waitUntil) setWaitUntil(0);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  async function run<K extends keyof DTO>(
    path: string,
    body: unknown,
    name: K,
    etag?: string | null,
    method: "POST" | "PATCH" = "POST",
    fingerprint?: string,
  ): Promise<{ data: DTO[K]; etag: string | null } | undefined> {
    if (!active.current || controller.current || waitUntil > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setFailure(null);
    const timeout = window.setTimeout(() => ctl.abort(), 15000);
    attempt.current = attemptFor(
      JSON.stringify([method, path, fingerprint ?? body]),
      etag ?? null,
      attempt.current,
    );
    request.current = { path, body: structuredClone(body), name, etag, method, fingerprint };
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
          "Content-Type": "application/json",
          ...(attempt.current.etag ? { "If-Match": attempt.current.etag } : {}),
        },
        body: JSON.stringify(body),
      });
      if (![200, 201, 202].includes(response.status)) fail(response);
      const parsed = schema(name).safeParse(await response.json());
      if (!parsed.success) throw new AccountFailure("uncertain");
      attempt.current = null;
      request.current = null;
      if (active.current) {
        if (path !== "/admin/qualification-rule-previews")
          await client.invalidateQueries({
            queryKey: ["qualification-workspace"],
          });
        if (active.current) return { data: parsed.data, etag: response.headers.get("ETag") };
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
        if (safe.kind === "conflict")
          await client.invalidateQueries({
            queryKey: ["qualification-workspace"],
          });
        if (!["uncertain", "unavailable", "limited"].includes(safe.kind)) {
          attempt.current = null;
          request.current = null;
        }
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
    canRecover:
      !!request.current && !!failure && ["uncertain", "unavailable"].includes(failure.kind),
    recover: () => {
      const saved = request.current;
      return saved
        ? run(saved.path, saved.body, saved.name, saved.etag, saved.method, saved.fingerprint)
        : Promise.resolve(undefined);
    },
    reset: () => {
      attempt.current = null;
      request.current = null;
      setFailure(null);
    },
  };
}
