import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  telemetryCommands as commands,
  desc,
  eq,
  telemetryInstallations as installations,
  isNull,
  telemetryLimits as limits,
  lt,
  ne,
  or,
  telemetryTokens as tokens,
} from "@vtc/db/telemetry-schema";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import type { ExternalIdentities } from "../external-identities/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";
import type { Telemetry as Event } from "../sources/contracts/telemetry.js";
import type { Trips } from "../trips/service.js";
import { fail, TelemetryError } from "./parser.js";

type Token = typeof tokens.$inferSelect;
type Info = components["schemas"]["TokenInfo"];
export interface TelemetryConfig {
  cursorKey: string;
  ipPerMinute: number;
  globalPerMinute: number;
}
export function validateTelemetryConfig(config: TelemetryConfig) {
  if (
    !/^[0-9a-f]{64}$/.test(config.cursorKey) ||
    !Number.isSafeInteger(config.ipPerMinute) ||
    config.ipPerMinute < 60 ||
    config.ipPerMinute > 60000 ||
    !Number.isSafeInteger(config.globalPerMinute) ||
    config.globalPerMinute < config.ipPerMinute ||
    config.globalPerMinute > 60000
  )
    throw new Error("INVALID_TELEMETRY_CONFIG");
}
export async function invalidateTelemetryCredentials(
  unit: UnitOfWork,
  tx: TxContext,
  userId: string,
) {
  await unit
    .client(tx)
    .update(tokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(tokens.ownerId, userId), eq(tokens.scope, "ingest"), isNull(tokens.revokedAt)));
}
const hash = (s: string) => createHash("sha256").update(s).digest();
const info = (t: Info): Info => ({
  id: t.id,
  label: t.label,
  createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt,
  revokedAt: t.revokedAt,
});
export function createTelemetry(
  unit: UnitOfWork,
  config: TelemetryConfig,
  ports: {
    identity: Identity;
    external: Pick<ExternalIdentities, "captureCredential" | "credentialEligible">;
    trips: Pick<Trips, "storeInTransaction">;
  },
  now = () => new Date(),
) {
  validateTelemetryConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString();
  const sign = (s: string) =>
    createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
      .update("telemetry/cursor/v1\0")
      .update(s)
      .digest("base64url");
  const run = async <T>(fn: (tx: TxContext) => Promise<T>): Promise<T> => {
    try {
      return await retryTransaction(unit, fn);
    } catch (e) {
      if (unknownCommit(e)) throw Object.assign(identityError(503), { cause: e });
      if (
        causes(e).some(
          (x) =>
            ("code" in x &&
              [
                "ER_LOCK_WAIT_TIMEOUT",
                "ER_LOCK_DEADLOCK",
                "PROTOCOL_SEQUENCE_TIMEOUT",
                "ETIMEDOUT",
                "ECONNREFUSED",
                "ECONNRESET",
                "PROTOCOL_CONNECTION_LOST",
                "EPIPE",
                "ER_CON_COUNT_ERROR",
                "ER_TOO_MANY_USER_CONNECTIONS",
              ].includes(String(x.code))) ||
            (x instanceof Error &&
              [
                "No connections available.",
                "Pool is closed.",
                "TRANSACTION_CONTROL_TIMEOUT",
              ].includes(x.message)),
        )
      )
        throw identityError(503);
      throw e;
    }
  };
  const admissions = new WeakSet<object>();
  async function browser(tx: TxContext, actor: Actor) {
    await ports.identity.authorizeInTransaction(tx, actor, "trips.submit_own");
    const state = await ports.identity.accessState(tx, actor.userId);
    // Epoch fencing stays permanent if telemetry was disabled during a security change.
    await c(tx)
      .update(tokens)
      .set({ revokedAt: at() })
      .where(
        and(
          eq(tokens.ownerId, actor.userId),
          isNull(tokens.revokedAt),
          or(
            ne(tokens.accessEpoch, state.accessEpoch),
            ne(tokens.identityEpoch, state.identityEpoch),
            ne(tokens.credentialEpoch, state.credentialEpoch),
          ),
        ),
      );
  }
  async function authenticate(tx: TxContext, bearer: string | undefined) {
    const match = /^Bearer vtc1_([0-9a-f-]{36})_([A-Za-z0-9_-]{43})$/.exec(bearer ?? "");
    if (!match?.[1] || !match[2]) return { error: new TelemetryError(401, "TOKEN_INVALID") };
    let id: string;
    try {
      id = applicationId(match[1]);
    } catch {
      return { error: new TelemetryError(401, "TOKEN_INVALID") };
    }
    const [lookup] = await c(tx).select().from(tokens).where(eq(tokens.id, id));
    if (!lookup) return { error: new TelemetryError(401, "TOKEN_INVALID") };
    // Owner facade locks company/member and Steam before any credential/source locks.
    let eligible = false;
    try {
      eligible = await ports.external.credentialEligible(tx, {
        userId: lookup.ownerId,
        steamId: lookup.steamId.toString(),
        accessEpoch: lookup.accessEpoch,
        identityEpoch: lookup.identityEpoch,
        credentialEpoch: lookup.credentialEpoch,
      });
    } catch (e) {
      if (
        !(
          e &&
          typeof e === "object" &&
          "statusCode" in e &&
          [403, 404].includes(Number(e.statusCode))
        )
      )
        throw e;
    }
    const access = await ports.identity.accessState(tx, lookup.ownerId);
    const [token] = await c(tx).select().from(tokens).where(eq(tokens.id, id)).for("update");
    if (
      !token ||
      !timingSafeEqual(hash(match[2]), token.secretHash) ||
      token.revokedAt ||
      token.scope !== "ingest"
    )
      return { error: new TelemetryError(401, "TOKEN_INVALID") };
    if (
      !eligible ||
      access.companyId !== token.companyId ||
      !access.active ||
      !access.canSubmitTrips
    ) {
      await c(tx).update(tokens).set({ revokedAt: at() }).where(eq(tokens.id, id));
      return { error: new TelemetryError(403, "INGESTION_FORBIDDEN") };
    }
    return { token };
  }
  // Fixed anonymous source slots bound storage; collisions share a conservative budget.
  async function charge(
    tx: TxContext,
    token: Token | undefined,
    ip: string,
    lane: "events" | "control",
  ) {
    const ipSlot =
      createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
        .update("telemetry/ip/v1\0")
        .update(ip)
        .digest()
        .readUInt16BE(0) % 512;
    const buckets = [
      ...(token ? [{ key: `token:${token.id}:${lane}`, rate: 60, burst: 10 }] : []),
      { key: `ip:${ipSlot}`, rate: config.ipPerMinute, burst: config.ipPerMinute },
      { key: "global", rate: config.globalPerMinute, burst: config.globalPerMinute },
    ];
    const ms = now().getTime();
    for (const b of buckets) {
      const key = Buffer.from(b.key);
      await c(tx)
        .insert(limits)
        .values({ key, credits: b.burst * 60000, updatedMs: Buffer.from(String(ms)) })
        .onDuplicateKeyUpdate({ set: { key } });
      const [row] = await c(tx).select().from(limits).where(eq(limits.key, key)).for("update");
      if (!row) throw new Error("TELEMETRY_LIMIT_MISSING");
      const credits = Math.min(
        b.burst * 60000,
        row.credits + Math.max(0, ms - Number(row.updatedMs.toString())) * b.rate,
      );
      const denied =
        credits < 60000 ? Math.max(1, Math.ceil((60000 - credits) / b.rate / 1000)) : 0;
      await c(tx)
        .update(limits)
        .set({
          credits: Math.floor(denied ? credits : credits - 60000),
          updatedMs: Buffer.from(String(Math.max(ms, Number(row.updatedMs.toString())))),
        })
        .where(eq(limits.key, key));
      // A denied credential/source cannot spend a shared downstream budget.
      if (denied) return denied;
    }
    return 0;
  }
  async function use<T>(
    bearer: string | undefined,
    ip: string,
    lane: "events" | "control",
    fn: (tx: TxContext, token: Token) => Promise<T>,
    admission?: object,
  ): Promise<T> {
    const admitted = !!admission && admissions.delete(admission);
    const command = async (tx: TxContext) => {
      const auth = await authenticate(tx, bearer);
      const wait = admitted ? 0 : await charge(tx, auth.token, ip, lane);
      if (auth.error) return { failure: auth.error };
      if (wait) return { failure: new TelemetryError(429, "RATE_LIMITED", wait) };
      const value = await fn(tx, auth.token);
      await c(tx).update(tokens).set({ lastUsedAt: at() }).where(eq(tokens.id, auth.token.id));
      return { value };
    };
    let result: Awaited<ReturnType<typeof command>>;
    try {
      result = await run(command);
    } catch (e) {
      // Only an actual duplicate-key rollback permits a fresh authoritative resolution.
      if (!unknownCommit(e) && causes(e).some((x) => "code" in x && x.code === "ER_DUP_ENTRY"))
        result = await run(command);
      else throw e;
    }
    if (result.failure) throw result.failure;
    return result.value as T;
  }
  return {
    config,
    async admit(bearer: string | undefined, ip: string, lane: "events" | "control") {
      const outcome = await run(async (tx) => {
        const auth = await authenticate(tx, bearer),
          wait = await charge(tx, auth.token, ip, lane);
        return auth.error ?? (wait ? new TelemetryError(429, "RATE_LIMITED", wait) : null);
      });
      if (outcome) throw outcome;
      const ticket = {};
      admissions.add(ticket);
      return ticket;
    },
    async issue(actor: Actor, key: string, input: components["schemas"]["TokenInput"]) {
      applicationId(key);
      const secret = randomBytes(32).toString("base64url"),
        tokenId = newId();
      const result = await run(async (tx) => {
        await browser(tx, actor);
        const credential = await ports.external.captureCredential(tx, actor.userId);
        const fingerprint = hash(canonicalJson(input));
        const [saved] = await c(tx)
          .select()
          .from(commands)
          .where(and(eq(commands.ownerId, actor.userId), eq(commands.key, key)))
          .for("update");
        if (saved) {
          if (!timingSafeEqual(saved.fingerprint, fingerprint))
            throw identityError(409, "IDEMPOTENCY_CONFLICT");
          return { already: saved.tokenId };
        }
        const row = {
          id: tokenId,
          ownerId: actor.userId,
          companyId: credential.companyId,
          steamId: Buffer.from(credential.steamId),
          accessEpoch: credential.accessEpoch,
          identityEpoch: credential.identityEpoch,
          credentialEpoch: credential.credentialEpoch,
          scope: "ingest" as const,
          secretHash: hash(secret),
          label: input.label,
          createdAt: at(),
          lastUsedAt: null,
          revokedAt: null,
        };
        await c(tx).insert(tokens).values(row);
        await c(tx).insert(commands).values({ ownerId: actor.userId, key, fingerprint, tokenId });
        return { row };
      });
      if (result.already)
        throw Object.assign(identityError(409, "SECRET_ALREADY_ISSUED"), {
          ownResourceId: result.already,
        });
      if (!result.row) throw new Error("TELEMETRY_ISSUANCE_MISSING");
      return { token: `vtc1_${tokenId}_${secret}`, info: info(result.row) };
    },
    async list(actor: Actor, page: { limit?: number; cursor?: string }) {
      const limit = page.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
      const binding = [
        actor.userId,
        actor.sessionId,
        actor.accessEpoch,
        actor.credentialEpoch,
        limit,
      ];
      let after: { createdAt: string; id: string } | undefined;
      if (page.cursor)
        try {
          if (page.cursor.length > 2048) throw new Error();
          const [body = "", mac = "", extra] = page.cursor.split(".");
          if (
            extra ||
            !/^[A-Za-z0-9_-]{43}$/.test(mac) ||
            !timingSafeEqual(Buffer.from(mac), Buffer.from(sign(body)))
          )
            throw new Error();
          const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
          if (canonicalJson(parsed.binding) !== canonicalJson(binding)) throw new Error();
          applicationId(parsed.id);
          if (new Date(parsed.createdAt).toISOString() !== parsed.createdAt) throw new Error();
          after = parsed;
        } catch {
          throw identityError(409, "VERSION_CONFLICT");
        }
      return run(async (tx) => {
        await browser(tx, actor);
        const rows = await c(tx)
          .select({
            id: tokens.id,
            label: tokens.label,
            createdAt: tokens.createdAt,
            lastUsedAt: tokens.lastUsedAt,
            revokedAt: tokens.revokedAt,
          })
          .from(tokens)
          .where(
            and(
              eq(tokens.ownerId, actor.userId),
              ...(after
                ? [
                    or(
                      lt(tokens.createdAt, after.createdAt),
                      and(eq(tokens.createdAt, after.createdAt), lt(tokens.id, after.id)),
                    ),
                  ]
                : []),
            ),
          )
          .orderBy(desc(tokens.createdAt), desc(tokens.id))
          .limit(limit + 1);
        const selected = rows.slice(0, limit),
          last = selected.at(-1);
        const body = last
          ? Buffer.from(
              JSON.stringify({ binding, createdAt: last.createdAt, id: last.id }),
            ).toString("base64url")
          : "";
        return {
          items: selected.map(info),
          nextCursor: rows.length > limit ? `${body}.${sign(body)}` : null,
        };
      });
    },
    async revoke(actor: Actor, key: string, tokenId: string) {
      applicationId(key);
      applicationId(tokenId);
      return run(async (tx) => {
        await browser(tx, actor);
        const [row] = await c(tx)
          .select()
          .from(tokens)
          .where(and(eq(tokens.id, tokenId), eq(tokens.ownerId, actor.userId)))
          .for("update");
        if (!row) throw identityError(404);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:telemetry-revoke`,
          key,
          { tokenId },
          async () => {
            if (!row.revokedAt)
              await c(tx).update(tokens).set({ revokedAt: at() }).where(eq(tokens.id, tokenId));
            return { id: tokenId, version: 1 };
          },
        );
        return { id: String(result.id), version: Number(result.version) };
      });
    },
    connection(bearer: string | undefined, ip: string, admission?: object) {
      return use(
        bearer,
        ip,
        "control",
        async (_tx, t) => ({
          contract: { major: 1, minor: 0 },
          accountId: t.ownerId,
          companyId: t.companyId,
          identityEpoch: t.identityEpoch,
          limits: { maxEventBytes: 65536, maxDepth: 16, eventsPerMinute: 60, burst: 10 },
        }),
        admission,
      );
    },
    register(bearer: string | undefined, ip: string, clientId: string, admission?: object) {
      return use(
        bearer,
        ip,
        "control",
        async (tx, t) => {
          const [saved] = await c(tx)
            .select()
            .from(installations)
            .where(
              and(
                eq(installations.ownerId, t.ownerId),
                eq(installations.companyId, t.companyId),
                eq(installations.identityEpoch, t.identityEpoch),
                eq(installations.clientId, Buffer.from(clientId)),
              ),
            )
            .for("update");
          const row = saved ?? {
            id: newId(),
            bindingId: newId(),
            ownerId: t.ownerId,
            companyId: t.companyId,
            identityEpoch: t.identityEpoch,
            clientId: Buffer.from(clientId),
            createdAt: at(),
          };
          if (!saved) await c(tx).insert(installations).values(row);
          return {
            contract: { major: 1, minor: 0 },
            installationId: row.id,
            bindingId: row.bindingId,
            identityEpoch: row.identityEpoch,
          };
        },
        admission,
      );
    },
    receive(bearer: string | undefined, ip: string, p: Event, admission?: object) {
      return use(
        bearer,
        ip,
        "events",
        async (tx, t) => {
          try {
            applicationId(p.installationId);
            applicationId(p.bindingId);
          } catch {
            return fail(409, "BINDING_MISMATCH");
          }
          const [binding] = await c(tx)
            .select()
            .from(installations)
            .where(eq(installations.id, p.installationId));
          if (
            !binding ||
            binding.bindingId !== p.bindingId ||
            binding.ownerId !== t.ownerId ||
            binding.companyId !== t.companyId ||
            binding.identityEpoch !== t.identityEpoch
          )
            return fail(409, "BINDING_MISMATCH");
          let saved: Awaited<ReturnType<Trips["storeInTransaction"]>>;
          try {
            saved = await ports.trips.storeInTransaction(tx, "ets2telemetry", p, {
              ownerUserId: t.ownerId,
              connection: { state: "bound", referenceId: binding.bindingId },
            });
          } catch (e) {
            if (e && typeof e === "object" && "statusCode" in e && e.statusCode === 409)
              return fail(409, "IDENTITY_CONFLICT");
            throw e;
          }
          return {
            contract: { major: 1, minor: 0 },
            eventId: p.eventId,
            receiptId: saved.sourceRecordId,
            status: saved.duplicate ? ("duplicate" as const) : ("stored" as const),
            firstReceivedAtUtcMs: Date.parse(saved.firstReceivedAt),
          };
        },
        admission,
      );
    },
  };
}
export type TelemetryService = ReturnType<typeof createTelemetry>;
