import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { EventFailure } from "../events/transport.js";
import { claimToast } from "./claims.js";
import {
  commandAttempt,
  mergeFeed,
  observeFeed,
  notificationAccountPath,
  type Attempt,
  type DTO,
  type Notification,
} from "./model.js";
import { notificationCommand, notificationRead, pollPage } from "./transport.js";

const visible = () => navigator.onLine && document.visibilityState === "visible";
type Feed = DTO["NotificationFeed"];
type Controller = {
  scope: string;
  current: () => boolean;
  blocked: boolean;
  feed: Feed | undefined;
  fetching: boolean;
  error: unknown;
  refresh: () => void;
  rebaseline: () => void;
  checkpoint: () => string | null;
  failure: (error: unknown, signal: AbortSignal) => Promise<void>;
  changed: () => Promise<void>;
  toasts: Notification[];
  dismiss: (id: string) => void;
};
const Context = createContext<Controller | null>(null);
export function useNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error("NOTIFICATION_BOUNDARY_MISSING");
  return context;
}
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const session = useSession(),
    location = useLocation();
  const scope =
    session.state === "authenticated" &&
    notificationAccountPath(location.pathname) &&
    session.self?.capabilities.includes("company.read")
      ? JSON.stringify([
          session.self.member.id,
          session.generation,
          session.self.identityEpoch,
          session.self.capabilities,
        ])
      : "";
  const authority = useRef(scope);
  authority.current = scope;
  const authorized = useCallback(() => authority.current === scope, [scope]);
  return scope ? (
    <ActiveNotifications key={scope} scope={scope} authorized={authorized}>
      {children}
    </ActiveNotifications>
  ) : (
    children
  );
}
function ActiveNotifications({
  scope,
  authorized,
  children,
}: {
  scope: string;
  authorized: () => boolean;
  children: ReactNode;
}) {
  const session = useSession(),
    client = useQueryClient();
  const [blocked, setBlocked] = useState(false),
    [toasts, setToasts] = useState<Notification[]>([]);
  const alive = useRef(false),
    denied = useRef(false),
    reconciliation = useRef<AbortController | null>(null),
    checkpoint = useRef<string | null>(null),
    baseline = useRef(true),
    seen = useRef(new Set<string>()),
    wake = useRef<() => void>(() => {}),
    channel = useRef<BroadcastChannel | null>(null);
  const current = useCallback(() => alive.current && !denied.current && authorized(), [authorized]);
  async function failure(error: unknown, signal: AbortSignal) {
    if (!current() || signal.aborted || !(error instanceof AccountFailure)) return;
    if (["unauthorized", "forbidden"].includes(error.kind)) {
      denied.current = true;
      setBlocked(true);
      setToasts([]);
      checkpoint.current = null;
      const verification = new AbortController();
      reconciliation.current?.abort();
      reconciliation.current = verification;
      const verificationSignal = AbortSignal.any([verification.signal, AbortSignal.timeout(15000)]);
      // Hide immediately; /me confirms whether this is session loss or a capability change.
      client.removeQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith("notifications-") && q.queryKey[1] === scope,
      });
      if (error.kind === "unauthorized") await session.confirmSessionLoss(verificationSignal);
      if (!verificationSignal.aborted && authorized()) await session.refresh();
    }
  }
  const query = useQuery({
    queryKey: ["notifications-feed", scope],
    meta: { private: true },
    enabled: false,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      let result: Feed;
      let pages = 0;
      const hadCheckpoint = checkpoint.current !== null;
      const liveItems: Notification[] = [];
      try {
        do {
          const cursor = checkpoint.current;
          pages++;
          const page = await pollPage(cursor, signal, () => {
            if (!current() || signal.aborted) throw new AccountFailure("unavailable");
            checkpoint.current = null;
            baseline.current = true;
            setToasts([]);
            void client.resetQueries({ queryKey: ["notifications-history", scope] });
          });
          if (!current() || signal.aborted || !visible()) throw new AccountFailure("unavailable");
          const feed = page.data;
          if (page.rebased) {
            baseline.current = true;
          }
          if (feed.hasMore && feed.nextCursor === cursor) throw new AccountFailure("unavailable");
          // Accept only a poll checkpoint. History pagination never enters this state.
          checkpoint.current = feed.nextCursor;
          result = { ...feed, items: mergeFeed([], feed.items) };
          liveItems.push(...observeFeed(feed.items, seen.current, baseline.current));
          if (!feed.hasMore) baseline.current = false;
        } while (result.hasMore && pages < 25 && current() && !signal.aborted && visible());
        if (!current() || signal.aborted || !visible()) throw new AccountFailure("unavailable");
        if (hadCheckpoint) {
          // Re-project the bounded bell window on every cycle. A cursor delta alone
          // cannot reveal a deleted target, private event or revoked subject access.
          // Its checkpoint is deliberately ignored so new arrivals remain in catch-up.
          const projection = await notificationRead(
            "/notifications?limit=50",
            "EnvelopeNotificationFeed",
            signal,
          );
          if (!current() || signal.aborted || !visible()) throw new AccountFailure("unavailable");
          result = {
            ...projection.data,
            nextCursor: checkpoint.current ?? result.nextCursor,
            hasMore: result.hasMore,
          };
        }
        const fresh = new Map(result.items.map((item) => [item.id, item]));
        setToasts((previous) =>
          previous.flatMap((item) => {
            const projected = fresh.get(item.id);
            return projected?.liveToastEligible && !projected.readAt ? [projected] : [];
          }),
        );
        for (const item of liveItems) {
          const projected = fresh.get(item.id);
          if (!projected?.liveToastEligible || projected.readAt) continue;
          if (await claimToast(item.id, () => current() && !signal.aborted && visible())) {
            if (current() && !signal.aborted && visible())
              setToasts((previous) => [...previous, projected].slice(-3));
          }
        }
        if (!current() || signal.aborted || !visible()) throw new AccountFailure("unavailable");
        void client.invalidateQueries(
          { queryKey: ["notifications-history", scope] },
          { cancelRefetch: false },
        );
        if (visible() && hadCheckpoint)
          void client.invalidateQueries(
            { queryKey: ["dashboard-upcoming-event"] },
            { cancelRefetch: false },
          );
        return result;
      } catch (error) {
        if (current() && !signal.aborted) {
          setToasts([]);
          // A rejected cursor is never reused, including when its fresh recovery failed.
          if (error instanceof EventFailure && [400, 409].includes(error.status)) {
            checkpoint.current = null;
            baseline.current = true;
            void client.resetQueries({ queryKey: ["notifications-history", scope] });
          }
        }
        await failure(error, signal);
        throw error;
      }
    },
  });
  const actions = useRef({ refetch: query.refetch, failure });
  actions.current = { refetch: query.refetch, failure };
  useEffect(() => {
    alive.current = true;
    let timer: number | undefined,
      stopped = false,
      busy = false,
      retryAt = 0,
      hintPending = false,
      again = false;
    const schedule = (delay: number) => {
      clearTimeout(timer);
      if (!stopped && current() && visible()) timer = window.setTimeout(() => void run(), delay);
    };
    const run = async () => {
      if (stopped || !current() || !visible()) return;
      if (Date.now() < retryAt) {
        schedule(retryAt - Date.now());
        return;
      }
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      clearTimeout(timer);
      const result = await actions.current.refetch({ cancelRefetch: false });
      busy = false;
      if (stopped) return;
      const retry = result.error instanceof AccountFailure ? result.error.retryAfter : null;
      retryAt = retry ? Date.now() + retry * 1000 : 0;
      schedule(
        Math.max(
          retry ? retry * 1000 : 0,
          result.isError ? 30000 : again || result.data?.hasMore ? 0 : 30000,
        ),
      );
      again = false;
    };
    const resume = () => {
      if (stopped || !current()) return;
      clearTimeout(timer);
      if (visible()) {
        if (hintPending) {
          hintPending = false;
          void client.invalidateQueries(
            { queryKey: ["notifications-preferences", scope] },
            { cancelRefetch: false },
          );
        }
        void client.invalidateQueries(
          { queryKey: ["dashboard-upcoming-event"] },
          { cancelRefetch: false },
        );
        void run();
      } else {
        setToasts([]);
        // A delayed response must not publish after the page becomes hidden/offline.
        void client.cancelQueries({ queryKey: ["notifications-feed", scope] });
      }
    };
    wake.current = () => void run();
    try {
      channel.current = new BroadcastChannel("vtc-notification-refresh-v1");
      channel.current.onmessage = (event) => {
        if (event.data === "refresh") {
          hintPending = true;
          resume();
        }
      };
    } catch {
      /* History and ordinary polling remain available. */
    }
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    document.addEventListener("visibilitychange", resume);
    schedule(0);
    return () => {
      stopped = true;
      alive.current = false;
      reconciliation.current?.abort();
      clearTimeout(timer);
      wake.current = () => {};
      channel.current?.close();
      channel.current = null;
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
      document.removeEventListener("visibilitychange", resume);
      void client.cancelQueries({
        predicate: (q) =>
          String(q.queryKey[0]).startsWith("notifications-") && q.queryKey[1] === scope,
      });
    };
  }, [scope, client, current]);
  const rebaseline = useCallback(() => {
    if (!current()) return;
    checkpoint.current = null;
    baseline.current = true;
    setToasts([]);
    void client.resetQueries({ queryKey: ["notifications-history", scope] });
    void client.cancelQueries({ queryKey: ["notifications-feed", scope] }).then(() => {
      if (current()) wake.current();
    });
  }, [client, scope, current]);
  return (
    <Context
      value={{
        scope,
        current,
        blocked,
        feed: blocked || query.isError ? undefined : query.data,
        fetching: query.isFetching,
        error: query.error,
        refresh: () => {
          if (blocked) session.changed();
          else wake.current();
        },
        rebaseline,
        checkpoint: () => checkpoint.current,
        failure,
        changed: async () => {
          if (!current()) return;
          await client.invalidateQueries({ queryKey: ["notifications-history", scope] });
          if (!current()) return;
          channel.current?.postMessage("refresh");
          wake.current();
        },
        toasts: blocked ? [] : toasts,
        dismiss: (id) => setToasts((previous) => previous.filter((item) => item.id !== id)),
      }}
    >
      {children}
    </Context>
  );
}
export function useNotificationCommand() {
  const context = useNotifications();
  const [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(null),
    [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now);
  const controller = useRef<AbortController | null>(null),
    attempt = useRef<Attempt | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      attempt.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  async function run<K extends "EnvelopeCommandResult" | "EnvelopeNotificationPreferences">(
    path: string,
    body: unknown,
    name: K,
    etag: string | null = null,
  ) {
    if (!context.current() || controller.current || until > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setError(null);
    // A later poll must not silently broaden a retry of an uncertain read-through.
    const payload =
      path === "/notifications/read-all" && attempt.current ? attempt.current.payload : body;
    attempt.current = commandAttempt(path, payload, etag, attempt.current);
    try {
      const result = await notificationCommand(
        path,
        payload,
        name,
        etag,
        attempt.current,
        ctl.signal,
      );
      if (!context.current() || ctl.signal.aborted) return;
      attempt.current = null;
      await context.changed();
      if (context.current() && !ctl.signal.aborted) return result;
    } catch (error) {
      if (context.current() && !ctl.signal.aborted) {
        setError(error);
        if (error instanceof AccountFailure) {
          if (!["uncertain", "unavailable", "limited"].includes(error.kind)) attempt.current = null;
          if (error.retryAfter) {
            setUntil(Date.now() + error.retryAfter * 1000);
            setNow(Date.now());
          }
          if (path === "/notifications/read-all" && error.kind === "conflict") context.rebaseline();
        }
        await context.failure(error, ctl.signal);
      }
    } finally {
      controller.current = null;
      if (context.current() && !ctl.signal.aborted) setPending(false);
    }
  }
  return { run, pending, error, seconds: Math.max(0, Math.ceil((until - now) / 1000)) };
}
export function OptionalNotifications({ children }: { children: ReactNode }) {
  return useContext(Context) ? children : null;
}
