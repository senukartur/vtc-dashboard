import { applicationId, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import { eq, truckersChecks } from "@vtc/db/admissions-schema";
import {
  createQueue,
  type Handler,
  RetryableJobError,
  retryTransaction,
} from "../../platform/jobs/queue.js";
import { closed } from "../../platform/outbox/events.js";
import { ProviderFailure } from "../external-identities/providers.js";

export const truckersCheckKind = "admissions.truckers-check";
const consumer = "admissions-truckers-check-v1";
// A check still running this long after its due attempt is shown as failed and may be restarted.
export const checkLeaseMs = 600_000;
// Provider attempts per generation and the delays after attempts 1..4.
export const maxCheckAttempts = 5;
export const retryDelaysMs = [60_000, 300_000, 900_000, 1_800_000] as const;
// Mirrors the member TruckersMP refresh interval: one provider request per minute per check.
export const recheckIntervalMs = 60_000;

type CheckFailure = "transport" | "timeout" | "rate_limited" | "unavailable" | "invalid_response";
const transient: readonly CheckFailure[] = ["transport", "timeout", "rate_limited", "unavailable"];
type Row = typeof truckersChecks.$inferSelect;
export interface ApplicantLookup {
  found: boolean;
  profile: {
    playerId: string;
    displayName: string;
    vtc: { inVtc: boolean; id: string | null; name: string | null; tag: string | null };
  } | null;
  bans: { any: boolean; count: number } | null;
}
// Throws ProviderFailure for classified provider outcomes; anything else counts as transport.
export interface TruckersPort {
  lookup(steamId: string): Promise<ApplicantLookup>;
}
interface StoredProfile {
  playerId: string;
  displayName: string;
  vtc: { inVtc: boolean; id: string | null; name: string | null; tag: string | null };
  bans: { any: boolean; count: number } | null;
}
export interface TruckersCheck {
  state: "checking" | "completed" | "not_checked" | "failed";
  notCheckedReason: "steam_vanity_url" | "not_requested" | null;
  found: boolean | null;
  playerId: string | null;
  displayName: string | null;
  profileUrl: string | null;
  bans: { any: boolean; count: number } | null;
  vtc: { inVtc: boolean; id: string | null; name: string | null; tag: string | null } | null;
  checkedAt: string | null;
  lastAttemptAt: string | null;
  failure: CheckFailure | null;
}

/** The canonical SteamID64 of a validated /profiles/ link; null for /id/ vanity links. */
export function steamIdFromProfileUrl(url: string): string | null {
  return /^https:\/\/steamcommunity\.com\/profiles\/([1-9][0-9]{16})\/?$/.exec(url)?.[1] ?? null;
}

/** Derives the private check projection; transient failures stay internal until failed. */
export function checkDto(row: Row | null | undefined, steamProfileUrl: string, now: Date) {
  const check: TruckersCheck = {
    state: "not_checked",
    notCheckedReason: null,
    found: null,
    playerId: null,
    displayName: null,
    profileUrl: null,
    bans: null,
    vtc: null,
    checkedAt: null,
    lastAttemptAt: null,
    failure: null,
  };
  if (!row || row.state === "not_checked")
    return {
      ...check,
      notCheckedReason: /^https:\/\/steamcommunity\.com\/id\//.test(steamProfileUrl)
        ? ("steam_vanity_url" as const)
        : ("not_requested" as const),
    };
  const overdue = row.state === "checking" && (row.leaseUntil === null || row.leaseUntil <= now);
  const state = overdue ? "failed" : row.state;
  const profile = row.found === true ? (row.profile as unknown as StoredProfile | null) : null;
  return {
    ...check,
    state,
    found: row.found,
    ...(profile
      ? {
          playerId: profile.playerId,
          displayName: profile.displayName,
          profileUrl: `https://truckersmp.com/user/${profile.playerId}`,
          bans: profile.bans ? { any: profile.bans.any, count: profile.bans.count } : null,
          vtc: {
            inVtc: profile.vtc.inVtc,
            id: profile.vtc.id,
            name: profile.vtc.name,
            tag: profile.vtc.tag,
          },
        }
      : {}),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    failure: state === "failed" ? (row.failure ?? "unavailable") : null,
  };
}

function reference(value: unknown) {
  const data = closed(value, ["applicationId", "generation", "attempt", "token"]);
  if (
    !Number.isSafeInteger(data.generation) ||
    (data.generation as number) < 1 ||
    !Number.isInteger(data.attempt) ||
    (data.attempt as number) < 1 ||
    (data.attempt as number) > maxCheckAttempts
  )
    throw new Error("INVALID_TRUCKERS_CHECK_REFERENCE");
  return {
    applicationId: applicationId(data.applicationId as string),
    generation: data.generation as number,
    attempt: data.attempt as number,
    token: applicationId(data.token as string),
  };
}
type Reference = ReturnType<typeof reference>;
type Prepared = { result: ApplicantLookup } | { failure: CheckFailure } | null;

function storedProfile(result: ApplicantLookup): StoredProfile | null {
  if (!result.found || !result.profile) return null;
  const { playerId, displayName, vtc } = result.profile;
  // Explicit fields only: the provider member ID and raw payload are never stored.
  return {
    playerId,
    displayName,
    vtc: { inVtc: vtc.inVtc, id: vtc.id, name: vtc.name, tag: vtc.tag },
    bans: result.bans ? { any: result.bans.any, count: result.bans.count } : null,
  };
}

export function createTruckersChecks(unit: UnitOfWork, port: TruckersPort, now: () => Date) {
  const c = (tx: TxContext) => unit.client(tx);
  const run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn);
  const later = (from: Date, ms: number) => new Date(from.getTime() + ms);

  async function locked(tx: TxContext, id: string) {
    const [row] = await c(tx)
      .select()
      .from(truckersChecks)
      .where(eq(truckersChecks.applicationId, id))
      .for("update");
    return row ?? null;
  }
  // A result applies only to the generation and attempt token that requested it.
  const current = (row: Row | null, ref: Reference): row is Row =>
    !!row &&
    row.state === "checking" &&
    row.generation === ref.generation &&
    row.leaseId === ref.token;

  const handler: Handler = {
    kind: truckersCheckKind,
    consumer,
    version: 1,
    mode: "local",
    validate: reference,
    async prepare(value, claim, signal): Promise<Prepared> {
      const ref = reference(value);
      const steamId = await run(async (tx) => {
        await queue.checkLease(tx, claim);
        const row = await locked(tx, ref.applicationId);
        if (!current(row, ref) || !row.steamId) return null;
        await c(tx)
          .update(truckersChecks)
          .set({ lastAttemptAt: now(), leaseUntil: later(now(), checkLeaseMs) })
          .where(eq(truckersChecks.applicationId, ref.applicationId));
        return row.steamId;
      });
      if (!steamId) return null;
      signal.throwIfAborted();
      // The read-only provider request runs outside every transaction and lock.
      let outcome: Prepared;
      try {
        outcome = { result: await port.lookup(steamId) };
      } catch (error) {
        outcome = { failure: error instanceof ProviderFailure ? error.category : "transport" };
      }
      if (signal.aborted) throw new RetryableJobError();
      return outcome;
    },
    async local(tx, value, _claim, prepared) {
      const outcome = prepared as Prepared;
      if (!outcome) return;
      const ref = reference(value);
      const row = await locked(tx, ref.applicationId);
      if (!current(row, ref)) return;
      const where = eq(truckersChecks.applicationId, ref.applicationId);
      if ("result" in outcome) {
        await c(tx)
          .update(truckersChecks)
          .set({
            state: "completed",
            found: outcome.result.found,
            profile: storedProfile(outcome.result) as Record<string, unknown> | null,
            checkedAt: now(),
            failure: null,
            leaseId: null,
            leaseUntil: null,
          })
          .where(where);
        return;
      }
      if (transient.includes(outcome.failure) && ref.attempt < maxCheckAttempts) {
        const token = newId(),
          availableAt = later(now(), retryDelaysMs[ref.attempt - 1] ?? recheckIntervalMs);
        await c(tx)
          .update(truckersChecks)
          .set({
            failure: outcome.failure,
            leaseId: token,
            leaseUntil: later(availableAt, checkLeaseMs),
          })
          .where(where);
        await enqueue(tx, { ...ref, attempt: ref.attempt + 1, token }, availableAt);
        return;
      }
      await c(tx)
        .update(truckersChecks)
        .set({ state: "failed", failure: outcome.failure, leaseId: null, leaseUntil: null })
        .where(where);
    },
  };
  const queue = createQueue(unit, [handler]);
  async function enqueue(tx: TxContext, ref: Reference, availableAt: Date) {
    await queue.enqueue(tx, {
      kind: truckersCheckKind,
      consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: `truckers:${ref.applicationId}:${ref.token}`,
      reference: ref,
      availableAt: availableAt.toISOString(),
      // Claims cover worker crashes; provider retries are separate chained attempts.
      maxAttempts: 3,
    });
  }

  return {
    handler,
    /**
     * Starts a new generation on the caller's transaction, which already holds the application
     * row. A running check that is not overdue is returned unchanged.
     */
    async start(tx: TxContext, id: string, steamId: string, steamProfileUrl: string) {
      const row = await locked(tx, id),
        at = now();
      if (row?.state === "checking" && row.leaseUntil && row.leaseUntil > at)
        return checkDto(row, steamProfileUrl, at);
      const token = newId(),
        due = row?.lastAttemptAt ? later(row.lastAttemptAt, recheckIntervalMs) : at,
        availableAt = due > at ? due : at,
        generation = (row?.generation ?? 0) + 1;
      const next = {
        state: "checking" as const,
        generation,
        steamId,
        requestedAt: at,
        failure: null,
        leaseId: token,
        leaseUntil: later(availableAt, checkLeaseMs),
      };
      if (row)
        await c(tx).update(truckersChecks).set(next).where(eq(truckersChecks.applicationId, id));
      else
        await c(tx)
          .insert(truckersChecks)
          .values({ applicationId: id, ...next });
      await enqueue(tx, { applicationId: id, generation, attempt: 1, token }, availableAt);
      return checkDto(
        {
          applicationId: id,
          found: null,
          profile: null,
          checkedAt: null,
          lastAttemptAt: null,
          ...row,
          ...next,
        },
        steamProfileUrl,
        at,
      );
    },
  };
}
export type TruckersChecks = ReturnType<typeof createTruckersChecks>;
export async function readTruckersCheck(
  unit: UnitOfWork,
  tx: TxContext,
  id: string,
  steamProfileUrl: string,
  now: Date,
) {
  const [row] = await unit
    .client(tx)
    .select()
    .from(truckersChecks)
    .where(eq(truckersChecks.applicationId, id));
  return checkDto(row, steamProfileUrl, now);
}
