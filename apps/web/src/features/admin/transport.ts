import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import { retryDelay } from "../admissions/transport.js";
import { type DTO, qualificationRead, schema } from "../qualifications/transport.js";

export type { DTO };
export class AdministrationFailure extends AccountFailure {
  constructor(
    kind: AccountFailure["kind"],
    public readonly ownResourceId: string | null = null,
    delay: number | null = null,
  ) {
    super(kind, delay);
  }
}
import { frozenAttempt, type RequestAttempt } from "./attempt.js";
export function useWorkspaceQuery<K extends keyof DTO>(path: string, name: K, enabled = true) {
  const session = useSession();
  const query = useQuery({
    queryKey: [
      "administration",
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
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
        const result = await qualificationRead(path, name, signal);
        signal.throwIfAborted();
        return result;
      } catch (error) {
        if (!signal.aborted && error instanceof AccountFailure) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            // Reconcile current authority before changing other reads. A resource-level
            // denial at unchanged authority must not strand permitted pending queries.
            // Authority-bound keys and Session's private-cache clearing cancel obsolete reads.
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
export function useWorkspaceCommand() {
  const client = useQueryClient(),
    session = useSession(),
    active = useRef(true),
    controller = useRef<AbortController | null>(null),
    attempt = useRef<RequestAttempt | null>(null);
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<AdministrationFailure | null>(null),
    [held, setHeld] = useState(false),
    [committed, setCommitted] = useState(false),
    [until, setUntil] = useState(0),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      attempt.current = null;
    };
  }, []);
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  async function refresh(changedPath?: string) {
    const predicate = (query: { queryKey: readonly unknown[] }) => {
      const path = String(query.queryKey.at(-2));
      if (
        ["EnvelopeSourceCapabilities", "EnvelopePersonalConnectionCapabilities"].includes(
          String(query.queryKey.at(-1)),
        )
      )
        return false;
      if (!changedPath) return true;
      if (changedPath.startsWith("/me/telemetry-tokens"))
        return path.startsWith("/me/telemetry-tokens");
      if (changedPath.startsWith("/admin/members"))
        return path.startsWith("/admin/members") || path.startsWith("/admin/audit");
      if (changedPath.startsWith("/admin/company-settings"))
        return path.startsWith("/admin/company-settings") || path.startsWith("/admin/audit");
      if (
        ["/admin/applications", "/admin/invitations", "/mail-deliveries"].some((prefix) =>
          changedPath.startsWith(prefix),
        )
      )
        return ["/admin/applications", "/admin/invitations", "/mail-deliveries"].some((prefix) =>
          path.startsWith(prefix),
        );
      return true;
    };
    await client.cancelQueries({ queryKey: ["administration"], predicate });
    client.removeQueries({ queryKey: ["administration"], type: "inactive", predicate });
    await client.resetQueries({ queryKey: ["administration"], type: "active", predicate });
  }
  async function run<K extends keyof DTO>(
    path: string,
    name: K,
    body?: unknown,
    etag: string | null = null,
    method = "POST",
    refreshReads = true,
  ): Promise<DTO[K] | undefined> {
    if (controller.current || until > Date.now()) return;
    attempt.current = frozenAttempt(path, method, body, etag, attempt.current);
    const request = attempt.current,
      current = new AbortController();
    controller.current = current;
    setPending(true);
    setFailure(null);
    setCommitted(false);
    const timer = setTimeout(() => current.abort(), 15000);
    try {
      const csrf = await read("/auth/csrf", csrfEnvelope, current.signal);
      const response = await fetch(`/api/v1${request.path}`, {
        method: request.method,
        credentials: "same-origin",
        cache: "no-store",
        signal: current.signal,
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": csrf.data.data.token,
          "Idempotency-Key": request.key,
          ...(request.etag ? { "If-Match": request.etag } : {}),
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      if (![200, 201, 202].includes(response.status)) {
        const parsed = schema("Error").safeParse(await response.json());
        const own =
          parsed.success && parsed.data.error.code === "SECRET_ALREADY_ISSUED"
            ? (parsed.data.error.details?.find((row) => row.ownResourceId)?.ownResourceId ?? null)
            : null;
        const kinds: Record<number, AccountFailure["kind"]> = {
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
        throw new AdministrationFailure(
          kinds[response.status] ?? "uncertain",
          own,
          retryDelay(response.headers.get("Retry-After")),
        );
      }
      const parsed = schema(name).safeParse(await response.json());
      if (!parsed.success) throw new AdministrationFailure("uncertain");
      if (!active.current || current.signal.aborted) return;
      // The confirmed response ends the command deadline. Subsequent read failures
      // cannot turn a committed command (including a one-show secret) into uncertainty.
      clearTimeout(timer);
      attempt.current = null;
      setHeld(false);
      setCommitted(true);
      if (refreshReads) void refresh(request.path).catch(() => undefined);
      if (request.path.startsWith(`/admin/members/${session.self?.member.id}/`))
        void session.refresh().catch(() => undefined);
      return parsed.data;
    } catch (error) {
      if (!active.current) return;
      const safe =
        error instanceof AdministrationFailure
          ? error
          : new AdministrationFailure(error instanceof AccountFailure ? error.kind : "uncertain");
      setFailure(safe);
      const uncertain = ["uncertain", "unavailable", "limited"].includes(safe.kind);
      if (!uncertain) attempt.current = null;
      setHeld(uncertain);
      if (safe.retryAfter) {
        setClock(Date.now());
        setUntil(Date.now() + safe.retryAfter * 1000);
      }
      if (safe.kind === "unauthorized") await session.confirmSessionLoss(current.signal);
      if (safe.kind === "conflict") await refresh(request.path);
      if (safe.kind === "forbidden") {
        await refresh();
        await session.refresh();
      }
      return;
    } finally {
      clearTimeout(timer);
      controller.current = null;
      if (active.current) setPending(false);
    }
  }
  return {
    run,
    refresh,
    pending,
    failure,
    held,
    committed,
    seconds: Math.max(0, Math.ceil((until - clock) / 1000)),
    dismiss: () => {
      attempt.current = null;
      setHeld(false);
      setFailure(null);
      setCommitted(false);
    },
  };
}
