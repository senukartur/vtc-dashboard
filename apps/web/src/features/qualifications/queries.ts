import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../../app/Session.js";
import { refreshWorkspaceSummary } from "../../app/workspace-summary-cache.js";
import { AccountFailure, read } from "../account/transport.js";
import { csrfEnvelope } from "../admissions/schema.js";
import {
  affectedQualificationProjection,
  affectedRead,
  type Change,
  type CommandOwner,
  commandChange,
  deferPagedQualificationRead,
  isRuleHistory,
  validateChangedResult,
} from "./changes.js";
import { fenceQualificationReads } from "./read-fence.js";
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
    client = useQueryClient();
  const query = useQuery({
    queryKey: [
      "qualification-workspace",
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
    // Version details are immutable; authority/session changes still get a different private key.
    staleTime: name === "EnvelopeQualificationRuleVersion" ? Number.POSITIVE_INFINITY : 0,
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
export function useQualificationCommand(
  owner?: CommandOwner,
  onRefresh?: () => void,
  onLevel?: (
    level: DTO["QualificationLevel"],
    operation: "rename" | "publish" | "schedule",
  ) => void,
  options?: { preserveLimitedRecovery?: boolean; refreshPromotions?: boolean },
) {
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
      owner: CommandOwner | undefined;
    } | null>(null);
  const [pending, setPending] = useState(false),
    [failure, setFailure] = useState<AccountFailure | null>(null),
    [recoveryLimited, setRecoveryLimited] = useState(false),
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
  const scope = [
    "qualification-workspace",
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
  ];
  const pathOf = (key: readonly unknown[]) =>
    typeof key.at(-2) === "string" ? (key.at(-2) as string) : "";
  async function refresh(change: Change, level?: DTO["QualificationLevel"], conflict = false) {
    const refreshPromotions = options?.refreshPromotions !== false;
    const affected = (path: string) =>
      affectedRead(change, path, session.self?.member.id, conflict, refreshPromotions);
    await fenceQualificationReads(client, scope, affected);
    if (change.kind === "level")
      await client.invalidateQueries({
        queryKey: scope,
        predicate: (query) => isRuleHistory(change.id, pathOf(query.queryKey)),
        refetchType: "none",
      });
    if (level) {
      // The validated command owns exactly one level. List ETags and other levels are untouched.
      type LevelsRead = Awaited<
        ReturnType<typeof qualificationRead<"EnvelopeListQualificationLevel">>
      >;
      client.setQueriesData<LevelsRead>(
        {
          queryKey: scope,
          predicate: (query) =>
            query.queryKey.at(-1) === "EnvelopeListQualificationLevel" &&
            affected(pathOf(query.queryKey)),
        },
        (previous) =>
          previous
            ? {
                ...previous,
                data: {
                  ...previous.data,
                  data: {
                    ...previous.data.data,
                    items: previous.data.data.items.map((item) =>
                      item.id === level.id &&
                      item.game === level.game &&
                      item.version < level.version
                        ? level
                        : item,
                    ),
                  },
                },
              }
            : previous,
      );
    }
    const dependent = (key: readonly unknown[]) => {
      const path = pathOf(key);
      if (change.kind === "level" && isRuleHistory(change.id, path)) return false;
      if (level && key.at(-1) === "EnvelopeListQualificationLevel") return false;
      return affected(path);
    };
    await client.invalidateQueries({
      queryKey: scope,
      predicate: (query) => dependent(query.queryKey),
      refetchType: "none",
    });
    await Promise.all([
      client.refetchQueries(
        {
          queryKey: scope,
          type: "active",
          // Cursor pages stay stale until their owner navigates or starts at the first page.
          predicate: (query) =>
            dependent(query.queryKey) &&
            !deferPagedQualificationRead(change, pathOf(query.queryKey)),
        },
        // Older reads were fenced above; only another post-commit read may be coalesced here.
        { cancelRefetch: false },
      ),
      refreshPromotions &&
      !conflict &&
      (change.kind === "ladder" ||
        (change.kind === "level" ? change.publication : !change.historical))
        ? refreshWorkspaceSummary(client, session)
        : undefined,
    ]);
    // The P10 provider owns its dashboard refresh after reloading session authority.
    const dashboardScope =
      refreshPromotions && session.self
        ? {
            memberId: session.self.member.id,
            generation: session.generation,
            identityEpoch: session.self.identityEpoch,
            access: session.self.capabilities.join(","),
          }
        : undefined;
    const projectionFilters = {
      predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
        affectedQualificationProjection(change, queryKey, dashboardScope),
    };
    await client.cancelQueries(projectionFilters);
    await client.invalidateQueries(projectionFilters, { cancelRefetch: false });
  }
  async function run<K extends keyof DTO>(
    path: string,
    body: unknown,
    name: K,
    etag?: string | null,
    method: "POST" | "PATCH" = "POST",
    fingerprint?: string,
    recovering = false,
  ): Promise<{ data: DTO[K]; etag: string | null } | undefined> {
    if (!active.current || controller.current || waitUntil > Date.now()) return;
    const ctl = new AbortController();
    controller.current = ctl;
    setPending(true);
    setFailure(null);
    setRecoveryLimited(false);
    const timeout = window.setTimeout(() => ctl.abort(), 15000);
    const previousAttempt = attempt.current,
      previousRequest = request.current;
    attempt.current = attemptFor(
      JSON.stringify([method, path, fingerprint ?? body]),
      etag ?? null,
      attempt.current,
    );
    const commandOwner =
      attempt.current === previousAttempt && previousRequest
        ? previousRequest.owner
        : structuredClone(owner);
    const replay = attempt.current === previousAttempt && previousRequest !== null;
    request.current = {
      path,
      body: structuredClone(body),
      name,
      etag,
      method,
      fingerprint,
      owner: commandOwner,
    };
    let change: Change | null = null;
    try {
      change = commandChange(commandOwner, path, body, method);
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
      if (change?.kind === "ladder") {
        const receipt = schema("EnvelopeQualificationLadderRevision").safeParse(parsed.data);
        if (!receipt.success || response.headers.get("ETag") !== `"v${receipt.data.data.revision}"`)
          throw new AccountFailure("uncertain");
      }
      const level = validateChangedResult(change, name, parsed.data);
      attempt.current = null;
      request.current = null;
      if (active.current) {
        if (level)
          onLevel?.(
            level,
            method === "PATCH"
              ? "rename"
              : body && typeof body === "object" && "effectiveAt" in body
                ? "schedule"
                : "publish",
          );
        onRefresh?.();
        // A replayed receipt is historical: reload current pointers instead of caching its old level.
        if (change)
          await refresh(
            change,
            replay || (level?.configured && level.freightRuleSummary === null) ? undefined : level,
          );
        // Only Trainee completion can change roles, and only the current member owns this session.
        // change comes from the frozen request, so uncertain replay survives refreshed eligibility.
        if (
          active.current &&
          change?.kind === "member" &&
          change.roleChange &&
          change.id === session.self?.member.id
        )
          await session.refresh();
        if (active.current) return { data: parsed.data, etag: response.headers.get("ETag") };
      }
    } catch (error) {
      const safe = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
      if (active.current) {
        setFailure(safe);
        if (options?.preserveLimitedRecovery && recovering && safe.kind === "limited")
          setRecoveryLimited(true);
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
        if (safe.kind === "conflict" && change) {
          onRefresh?.();
          await refresh(change, undefined, true);
        }
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
    matchesPending: (path: string, body: unknown, method: "POST" | "PATCH" = "POST") =>
      !!request.current && attempt.current?.fingerprint === JSON.stringify([method, path, body]),
    pending,
    failure,
    seconds: Math.max(0, Math.ceil((waitUntil - now) / 1000)),
    canRecover:
      !!request.current &&
      !!failure &&
      (["uncertain", "unavailable"].includes(failure.kind) || recoveryLimited),
    recover: () => {
      const saved = request.current;
      return saved
        ? run(saved.path, saved.body, saved.name, saved.etag, saved.method, saved.fingerprint, true)
        : Promise.resolve(undefined);
    },
    reset: () => {
      attempt.current = null;
      request.current = null;
      setFailure(null);
      setRecoveryLimited(false);
    },
  };
}
