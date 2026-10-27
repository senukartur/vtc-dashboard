import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import { type Attempt, commandAttempt, type DTO } from "./model.js";
import { eventRead, fail, schema } from "./transport.js";

export function useEventQuery<K extends keyof DTO>(path: string, name: K, enabled = true) {
  const session = useSession(),
    client = useQueryClient(),
    publicRead = path.startsWith("/public/");
  const query = useQuery({
    queryKey: publicRead
      ? ["public-events", path, name]
      : [
          "events",
          session.self?.member.id,
          session.generation,
          session.self?.identityEpoch,
          session.self?.capabilities.join(","),
          path,
          name,
        ],
    meta: { private: !publicRead },
    enabled: enabled && (publicRead || !!session.self),
    retry: false,
    gcTime: publicRead ? 300000 : 0,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      try {
        return await eventRead(path, name, signal);
      } catch (error) {
        if (!publicRead && !signal.aborted && error instanceof AccountFailure) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({ type: "inactive", predicate: (q) => q.meta?.private === true });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
  return {
    ...query,
    data: query.isError || (!publicRead && !session.self) ? undefined : query.data,
  };
}
export function useEventCommand(onFailure?: (failure: AccountFailure) => void) {
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
  async function refresh(
    commandPath: string,
    result?: { data: unknown; etag: string | null },
    replay = false,
  ) {
    const target = /^\/(?:admin\/)?events\/([^/]+)/.exec(commandPath)?.[1];
    const responseChange = commandPath.endsWith("/my-response"),
      attendanceChange = commandPath.endsWith("/attendance");
    const predicate = (q: { queryKey: readonly unknown[] }) => {
      const key = q.queryKey,
        path = String(key.at(-2)),
        url = new URL(path, "https://events.invalid");
      if (
        key[0] === "events" &&
        (key[1] !== session.self?.member.id || key[2] !== session.generation)
      )
        return false;
      if (responseChange)
        return (
          key[0] === "events" &&
          [
            `/events/${target}`,
            `/events/${target}/my-response`,
            `/events/${target}/participants`,
          ].includes(url.pathname)
        );
      if (attendanceChange)
        return (
          key[0] === "events" &&
          [`/events/${target}`, `/admin/events/${target}/attendance`].includes(url.pathname)
        );
      return (
        key[0] === "dashboard-upcoming-event" ||
        (["events", "public-events"].includes(String(key[0])) &&
          (/^\/(?:public\/)?events$/.test(url.pathname) ||
            url.pathname === `/events/${target}` ||
            url.pathname === `/public/events/${target}`))
      );
    };
    await client.cancelQueries({ predicate });
    if (result && !replay && responseChange) {
      const response = schema("EnvelopeRsvp").parse(result.data);
      client.setQueriesData({ predicate }, (previous: unknown) => {
        const own = schema("EnvelopeRsvp").safeParse((previous as { data?: unknown })?.data);
        if (own.success) return { data: response, etag: result.etag };
        const member = schema("EnvelopeEventMember").safeParse(
          (previous as { data?: unknown })?.data,
        );
        if (member.success)
          return {
            ...(previous as object),
            data: { ...member.data, data: { ...member.data.data, myResponse: response.data } },
          };
        return previous;
      });
    }
    await client.invalidateQueries({ predicate, refetchType: "none" });
    await client.refetchQueries(
      {
        type: "active",
        predicate: (q) =>
          predicate(q) &&
          !(
            result &&
            !replay &&
            responseChange &&
            !String(q.queryKey.at(-2)).includes("/participants")
          ) &&
          !q.queryKey.some((v) => typeof v === "string" && v.includes("cursor=")),
      },
      { cancelRefetch: false },
    );
  }
  async function run<K extends keyof DTO>(
    path: string,
    body: unknown,
    name: K,
    etag: string | null = null,
    method: "POST" | "PATCH" | "PUT" = "POST",
  ) {
    if (!active.current || controller.current || waitUntil > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setFailure(null);
    const timeout = window.setTimeout(() => ctl.abort(), 15000);
    const previousAttempt = attempt.current;
    attempt.current = commandAttempt(method, path, body, etag, attempt.current);
    const replay = previousAttempt === attempt.current;
    try {
      const csrf = await read("/auth/csrf", csrfEnvelope, ctl.signal);
      const response = await fetch(`/api/v1${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        signal: ctl.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf.data.data.token,
          "Idempotency-Key": attempt.current.key,
          ...(etag ? { "If-Match": etag } : {}),
        },
        body: JSON.stringify(body),
      });
      if (![200, 201, 202].includes(response.status)) fail(response);
      const parsed = schema(name).safeParse(await response.json());
      if (!parsed.success) throw new AccountFailure("uncertain");
      attempt.current = null;
      if (active.current) {
        await refresh(path, { data: parsed.data, etag: response.headers.get("ETag") }, replay);
        return { data: parsed.data, etag: response.headers.get("ETag") };
      }
    } catch (error) {
      const safe = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
      if (active.current) {
        setFailure(safe);
        onFailure?.(safe);
        if (safe.kind === "unauthorized") await session.confirmSessionLoss(ctl.signal);
        if (safe.kind === "forbidden") await session.refresh();
        if (safe.retryAfter) {
          setWaitUntil(Date.now() + safe.retryAfter * 1000);
          setNow(Date.now());
        }
        if (safe.kind === "conflict") await refresh(path);
        if (!["uncertain", "unavailable", "limited"].includes(safe.kind)) attempt.current = null;
      }
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (active.current) setPending(false);
    }
  }
  return { run, pending, failure, seconds: Math.max(0, Math.ceil((waitUntil - now) / 1000)) };
}
