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
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { AccountFailure, readSelf, type DTO } from "../features/account/transport.js";
import { Button, Card } from "../shared/ui/primitives.js";
import { clearPrivateQueries } from "./session-cache.js";
import i18n from "../shared/i18n.js";

type Session = {
  state: "checking" | "authenticated" | "anonymous" | "unavailable";
  self: DTO["Self"] | null;
  etag: string | null;
  generation: number;
  refresh: () => Promise<void>;
  confirmSessionLoss: (signal: AbortSignal) => Promise<void>;
  end: () => void;
  changed: () => void;
};
const SessionContext = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const location = useLocation();
  const [generation, setGeneration] = useState(0);
  const epoch = useRef(0);
  const identity = useRef<string | null>(null);
  const [ended, setEnded] = useState(false);
  const entry = useRef(location.key);
  const accountEntry = location.pathname.toLowerCase().startsWith("/account");
  useEffect(() => {
    const changed = entry.current !== location.key;
    entry.current = location.key;
    if (changed && accountEntry && ended) setEnded(false);
  }, [location.key, accountEntry, ended]);
  useEffect(() => {
    const resume = () => {
      if (navigator.onLine && document.visibilityState === "visible") {
        if (ended) setEnded(false);
        else
          void client.invalidateQueries(
            { queryKey: ["account-session"] },
            { cancelRefetch: false },
          );
      }
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [ended, client]);
  const clear = useCallback(() => {
    epoch.current += 1;
    identity.current = null;
    clearPrivateQueries(client);
    setGeneration(epoch.current);
  }, [client]);
  const end = useCallback(() => {
    setEnded(true);
    clear();
  }, [clear]);
  const query = useQuery({
    queryKey: [
      "account-session",
      generation,
      location.pathname.toLowerCase().startsWith("/account"),
    ],
    meta: { private: true },
    enabled:
      !ended &&
      (location.pathname.toLowerCase().startsWith("/account") ||
        location.pathname.toLowerCase().replace(/\/$/, "") === "/login" ||
        identity.current !== null),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async ({ signal }) => {
      const result = await readSelf(signal);
      if (signal.aborted || epoch.current !== generation) throw new AccountFailure("unavailable");
      if (identity.current && identity.current !== result.data.data.member.id) {
        clear();
        throw new AccountFailure("unavailable");
      }
      identity.current = result.data.data.member.id;
      return result;
    },
  });
  const unauthorized = query.error instanceof AccountFailure && query.error.kind === "unauthorized";
  useEffect(() => {
    if (unauthorized && !ended) {
      setEnded(true);
      clear();
    }
  }, [unauthorized, ended, clear]);
  const self = !ended && !query.isError ? (query.data?.data.data ?? null) : null;
  const preferredLocale = self?.preferences.locale;
  useEffect(() => {
    if (preferredLocale) void i18n.changeLanguage(preferredLocale);
  }, [preferredLocale]);
  const state =
    ended || unauthorized
      ? "anonymous"
      : query.isError
        ? "unavailable"
        : self
          ? "authenticated"
          : "checking";
  return (
    <SessionContext
      value={{
        state,
        self,
        etag: self ? (query.data?.etag ?? null) : null,
        generation,
        refresh: async () => {
          if (ended) {
            setEnded(false);
            clear();
          } else {
            await query.refetch({ cancelRefetch: false });
          }
        },
        confirmSessionLoss: async (signal) => {
          if (signal.aborted || epoch.current !== generation) return;
          try {
            await readSelf(signal);
          } catch (error) {
            if (
              !signal.aborted &&
              epoch.current === generation &&
              error instanceof AccountFailure &&
              error.kind === "unauthorized"
            )
              end();
          }
        },
        end,
        changed: () => {
          setEnded(false);
          clear();
        },
      }}
    >
      {children}
    </SessionContext>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SESSION_BOUNDARY_MISSING");
  return value;
}
export function ProtectedAccount({ children }: { children: ReactNode }) {
  const session = useSession();
  const { t } = useTranslation("account");
  const { pathname, search, hash } = useLocation();
  if (session.state !== "authenticated")
    return (
      <Card className="auth-card stack">
        <h1>
          {t(
            session.state === "anonymous"
              ? "signInRequired"
              : session.state === "checking"
                ? "checking"
                : "sessionUnavailable",
          )}
        </h1>
        {session.state === "anonymous" ? (
          <Button asChild>
            {/* Sign-in returns here; AuthPage validates the location before using it. */}
            <Link to="/login" state={{ from: { pathname, search, hash } }}>
              {t("login")}
            </Link>
          </Button>
        ) : session.state === "unavailable" ? (
          <>
            <p>{t("sessionUnavailableHelp")}</p>
            <Button onClick={() => void session.refresh()}>{t("refresh")}</Button>
          </>
        ) : (
          <p role="status">{t("checkingHelp")}</p>
        )}
      </Card>
    );
  return <div key={session.generation}>{children}</div>;
}
