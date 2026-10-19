import { useEffect, useRef, useState } from "react";
import {
  AccountFailure,
  attemptFor,
  command,
  type Attempt,
  type Inputs,
  type Operation,
} from "./transport.js";

// Secrets stay in a short-lived feature closure, never a Query mutation's variables/history.
export function useCommand() {
  const attempt = useRef<Attempt | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const lastFailure = useRef<AccountFailure | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    active.current = true;
    const expiry = window.setInterval(() => {
      if (attempt.current && attempt.current.expires <= Date.now()) attempt.current = null;
    }, 1000);
    return () => {
      active.current = false;
      controller.current?.abort();
      attempt.current = null;
      window.clearInterval(expiry);
    };
  }, []);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);
  const seconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  async function run<K extends Operation>(operation: K, payload: Inputs[K], etag?: string) {
    if (controller.current || waitUntil > Date.now()) return undefined;
    attempt.current = attemptFor(operation, payload, etag, attempt.current);
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setFailure(null);
    lastFailure.current = null;
    const timer = window.setTimeout(() => current.abort(), 15000);
    try {
      const result = await command(attempt.current, current.signal);
      if (!active.current) return undefined;
      attempt.current = null;
      return result;
    } catch (error) {
      if (active.current) {
        const safe = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
        lastFailure.current = safe;
        setFailure(safe);
        if (safe.retryAfter) {
          setNow(Date.now());
          setWaitUntil(Date.now() + safe.retryAfter * 1000);
        }
        if (!["uncertain", "unavailable", "limited"].includes(safe.kind)) attempt.current = null;
      }
      return undefined;
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
    lastFailure: () => lastFailure.current,
    seconds,
    reset: () => {
      attempt.current = null;
      setFailure(null);
    },
  };
}
