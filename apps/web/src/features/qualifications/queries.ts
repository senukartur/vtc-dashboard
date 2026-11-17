import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session.js";
import { refreshWorkspaceSummary } from "../../app/workspace-summary-cache.js";
import { AccountFailure } from "../account/transport.js";
import {
  type DTO,
  QualificationFailure,
  qualificationRead,
  qualificationWrite,
} from "./transport.js";

const root = "qualification-workspace";
function useScope() {
  const session = useSession();
  return [
    root,
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
  ];
}
export function useQualificationQuery<K extends keyof DTO>(path: string, name: K, enabled = true) {
  const session = useSession(),
    scope = useScope();
  const query = useQuery({
    queryKey: [...scope, path, name],
    meta: { private: true },
    enabled,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      try {
        return await qualificationRead(path, name, signal);
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") await session.refresh();
        }
        throw error;
      }
    },
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
/**
 * One command at a time. After a committed command every qualification read refetches, the
 * workspace summary and profile reads follow, and the session reloads when roles may have changed.
 */
export function useQualificationCommand() {
  const session = useSession(),
    client = useQueryClient(),
    active = useRef(true),
    controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<QualificationFailure | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, []);
  async function refresh(rolesMayChange: boolean) {
    await client.invalidateQueries({ queryKey: [root] });
    await client.invalidateQueries({
      predicate: (query) => query.meta?.private === true && query.queryKey[0] !== root,
    });
    await refreshWorkspaceSummary(client, session);
    if (rolesMayChange) await session.refresh();
  }
  async function run<K extends keyof DTO>(
    method: "POST" | "PUT",
    path: string,
    body: unknown,
    name: K,
    rolesMayChange: (result: DTO[K]) => boolean = () => false,
  ): Promise<DTO[K] | undefined> {
    if (controller.current) return;
    const ctl = new AbortController();
    controller.current = ctl;
    const timeout = window.setTimeout(() => ctl.abort(), 20000);
    setPending(true);
    setFailure(null);
    try {
      const result = await qualificationWrite(method, path, body, name, ctl.signal);
      if (active.current) await refresh(rolesMayChange(result));
      return result;
    } catch (error) {
      const safe =
        error instanceof QualificationFailure ? error : new QualificationFailure("uncertain");
      if (active.current) {
        setFailure(safe);
        if (safe.kind === "unauthorized") await session.confirmSessionLoss(ctl.signal);
        if (safe.kind === "forbidden") await session.refresh();
        // A stale version or a level changed elsewhere: reload so the next attempt starts fresh.
        if (safe.kind === "conflict") await client.invalidateQueries({ queryKey: [root] });
      }
      return undefined;
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (active.current) setPending(false);
    }
  }
  return { run, pending, failure, reset: () => setFailure(null) };
}
