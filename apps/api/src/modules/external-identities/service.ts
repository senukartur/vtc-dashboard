import { createHmac, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  newId,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import {
  and,
  asc,
  eq,
  gt,
  lt,
  or,
  sql,
  steamAccounts,
  steamChanges,
  steamLinks,
  steamNonces,
  steamProofs,
  truckersCache,
} from "@vtc/db/external-identities-schema";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  authorizationUrl,
  cacheLifetimeMs,
  type ExternalProviders,
  nonceLifetimeMs,
  parseAssertion,
  proofLifetimeMs,
  ProviderFailure,
  returnUrl,
  steamId,
  steamProfile,
  steamProvider,
  truckersProvider,
} from "./providers.js";

type Proof = typeof steamProofs.$inferSelect;
type Context = Awaited<ReturnType<Identity["externalContext"]>>;
type Wire = components["schemas"];
export interface ExternalCredential {
  userId: string;
  steamId: string;
  accessEpoch: number;
  identityEpoch: number;
  credentialEpoch: number;
}
export function steamProjection(unit: UnitOfWork) {
  return async (tx: TxContext, userId: string) =>
    !!(
      await unit
        .client(tx)
        .select({ id: steamLinks.userId })
        .from(steamLinks)
        .where(eq(steamLinks.userId, userId))
    )[0];
}
export function createExternalIdentities(
  unit: UnitOfWork,
  identity: Identity,
  providers: ExternalProviders = { steam: steamProvider(), truckers: truckersProvider() },
  now: () => Date = () => new Date(),
) {
  const client = (tx: TxContext) => unit.client(tx);
  const digest = (value: string) =>
    createHmac("sha256", identity.config.secret).update(`external:${value}`).digest();
  const equal = (a: string, b: string) => {
    const aa = Buffer.from(a),
      bb = Buffer.from(b);
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  };
  const state = (proof: Proof) =>
    digest(
      `state:${proof.id}:${proof.userId}:${proof.sessionId}:${proof.identityEpoch}:${proof.accessEpoch}:${proof.credentialEpoch}:${proof.emailEpoch}`,
    ).toString("base64url");
  const callback = (proof: Proof) => returnUrl(identity.config.origin, proof.id, state(proof));
  const id = (value: string) => {
    try {
      return applicationId(value);
    } catch {
      throw identityError(422);
    }
  };
  async function run<T>(command: (tx: TxContext) => Promise<T>): Promise<T> {
    try {
      return await identity.transaction(command);
    } catch (error) {
      let uncertain = error;
      for (let depth = 0; depth < 8 && uncertain && typeof uncertain === "object"; depth++) {
        if (uncertain instanceof TransactionCommitOutcomeUnknownError) throw uncertain;
        uncertain = "cause" in uncertain ? uncertain.cause : null;
      }
      let cause = error;
      for (let depth = 0; depth < 6 && cause && typeof cause === "object"; depth++) {
        if ("code" in cause && cause.code === "ER_DUP_ENTRY") throw identityError(409);
        cause = "cause" in cause ? cause.cause : null;
      }
      throw error;
    }
  }
  const link = async (tx: TxContext, userId: string) =>
    (
      await client(tx).select().from(steamLinks).where(eq(steamLinks.userId, userId)).for("update")
    )[0];
  const bound = (proof: Proof, target: Context, currentSteam: string | null) =>
    target.status === "active" &&
    proof.identityEpoch === target.identityEpoch &&
    proof.accessEpoch === target.accessEpoch &&
    proof.credentialEpoch === target.credentialEpoch &&
    proof.emailEpoch === target.emailEpoch &&
    proof.previousSteamId === currentSteam;
  async function currentProof(tx: TxContext, proofId: string, userId: string) {
    const [proof] = await client(tx)
      .select()
      .from(steamProofs)
      .where(and(eq(steamProofs.id, id(proofId)), eq(steamProofs.userId, userId)))
      .for("update");
    if (!proof) throw identityError(404);
    return proof;
  }
  function projectProof(
    proof: Proof,
    target: Context,
    currentSteam: string | null,
    sessions: ReadonlySet<string>,
  ): Wire["SteamReplacementProof"] {
    const terminal = ["applied", "failed", "invalidated"].includes(proof.state);
    const status = terminal
      ? proof.state
      : !bound(proof, target, currentSteam) || !sessions.has(proof.sessionId)
        ? "invalidated"
        : proof.expiresAt <= now()
          ? "expired"
          : proof.state;
    return {
      id: proof.id,
      memberId: proof.userId,
      identityEpoch: proof.identityEpoch,
      state: status as Wire["SteamReplacementProof"]["state"],
      candidateSteamProfileUrl: proof.candidateSteamId
        ? steamProfile(proof.candidateSteamId)
        : null,
      createdAt: proof.createdAt.toISOString(),
      expiresAt: proof.expiresAt.toISOString(),
      verifiedAt: proof.verifiedAt?.toISOString() ?? null,
    };
  }
  async function applyLink(
    tx: TxContext,
    actorId: string,
    target: Context,
    proof: Proof,
    candidate: string,
    reason: string,
  ) {
    const previous = await link(tx, target.userId);
    const [reserved] = await client(tx)
      .select()
      .from(steamAccounts)
      .where(eq(steamAccounts.steamId, candidate))
      .for("update");
    if (reserved && reserved.userId !== target.userId) throw identityError(409);
    if (!reserved)
      await client(tx)
        .insert(steamAccounts)
        .values({ steamId: candidate, userId: target.userId, createdAt: now() });
    // A proof for the current profile is consumed without a fictitious replacement or revocation.
    if (previous?.steamId === candidate) {
      await client(tx)
        .update(steamProofs)
        .set({ state: "applied" })
        .where(eq(steamProofs.id, proof.id));
      return { id: target.userId, version: target.version };
    }
    if (previous)
      await client(tx)
        .update(steamLinks)
        .set({ steamId: candidate })
        .where(eq(steamLinks.userId, target.userId));
    else await client(tx).insert(steamLinks).values({ userId: target.userId, steamId: candidate });
    const changed = await identity.externalChanged(
      tx,
      actorId,
      target.userId,
      previous ? "steam.replaced" : "steam.linked",
    );
    await client(tx)
      .update(steamProofs)
      .set({ state: "invalidated" })
      .where(and(eq(steamProofs.userId, target.userId), eq(steamProofs.state, "verified")));
    await client(tx)
      .update(steamProofs)
      .set({ state: "invalidated" })
      .where(and(eq(steamProofs.userId, target.userId), eq(steamProofs.state, "pending")));
    await client(tx)
      .update(steamProofs)
      .set({ state: "applied" })
      .where(eq(steamProofs.id, proof.id));
    await client(tx)
      .insert(steamChanges)
      .values({
        id: newId(),
        userId: target.userId,
        actorId,
        proofId: proof.id,
        previousSteamId: previous?.steamId ?? null,
        steamId: candidate,
        ...changed,
        reason,
        occurredAt: now(),
      });
    // Fence old provider receipts immediately; generations/leases are scoped to this link and epoch.
    await client(tx).delete(truckersCache).where(eq(truckersCache.userId, target.userId));
    await client(tx).insert(truckersCache).values({
      userId: target.userId,
      steamId: candidate,
      identityEpoch: changed.identityEpoch,
      generation: 0,
    });
    return { id: target.userId, version: changed.version };
  }
  async function snapshot(actor: Actor) {
    return run(async (tx) => {
      const target = await identity.externalContext(tx, actor),
        active = await link(tx, actor.userId);
      const [cache] = await client(tx)
        .select()
        .from(truckersCache)
        .where(eq(truckersCache.userId, actor.userId));
      const pending = await client(tx)
        .select()
        .from(steamProofs)
        .where(
          and(
            eq(steamProofs.userId, actor.userId),
            eq(steamProofs.identityEpoch, target.identityEpoch),
            gt(steamProofs.expiresAt, now()),
            or(eq(steamProofs.state, "pending"), eq(steamProofs.state, "verified")),
          ),
        )
        .orderBy(asc(steamProofs.id))
        .limit(2);
      const sessions = await identity.externalValidSessions(
        tx,
        target,
        pending.map((proof) => proof.sessionId),
      );
      const validPending = pending.filter(
        (p) =>
          ["pending", "verified"].includes(p.state) &&
          bound(p, target, active?.steamId ?? null) &&
          sessions.has(p.sessionId),
      );
      const replacement = validPending.find((p) => p.purpose === "replacement");
      const usable =
        cache?.steamId === active?.steamId && cache?.identityEpoch === target.identityEpoch
          ? cache
          : undefined;
      const fresh =
        !!usable?.checkedAt &&
        usable.checkedAt.getTime() + cacheLifetimeMs > now().getTime() &&
        !usable.failure;
      const data: Wire["Identity"] = {
        steamStatus: active
          ? "verified"
          : validPending.some((p) => p.purpose === "initial")
            ? "pending"
            : "unlinked",
        steamProfileUrl: active ? steamProfile(active.steamId) : null,
        pendingReplacementId: replacement?.id ?? null,
        identityEpoch: target.identityEpoch,
        truckersMp: {
          status: !active
            ? "not_linked"
            : usable?.checkedAt
              ? fresh
                ? "available"
                : "stale"
              : "unavailable",
          displayName: usable?.profile?.displayName ?? null,
          checkedAt: usable?.checkedAt?.toISOString() ?? null,
          found: usable?.found ?? null,
          playerId: usable?.profile?.playerId ?? null,
          vtc: usable?.profile?.vtc ?? null,
          lastAttemptAt: usable?.lastAttemptAt?.toISOString() ?? null,
          failure: usable?.failure ?? null,
        },
      };
      return { data, version: target.version };
    });
  }
  async function refresh(actor: Actor) {
    const lease = await run(async (tx) => {
      const target = await identity.externalContext(tx, actor),
        active = await link(tx, actor.userId);
      if (!active) return null;
      let [cache] = await client(tx)
        .select()
        .from(truckersCache)
        .where(eq(truckersCache.userId, actor.userId))
        .for("update");
      if (!cache) {
        await client(tx).insert(truckersCache).values({
          userId: actor.userId,
          steamId: active.steamId,
          identityEpoch: target.identityEpoch,
          generation: 0,
        });
        [cache] = await client(tx)
          .select()
          .from(truckersCache)
          .where(eq(truckersCache.userId, actor.userId))
          .for("update");
      }
      if (!cache) throw identityError(503);
      const same = cache.steamId === active.steamId && cache.identityEpoch === target.identityEpoch;
      if (
        same &&
        ((cache.leaseUntil && cache.leaseUntil > now()) ||
          (cache.lastAttemptAt && cache.lastAttemptAt.getTime() + 60000 > now().getTime()) ||
          (cache.checkedAt &&
            cache.checkedAt.getTime() + cacheLifetimeMs > now().getTime() &&
            !cache.failure))
      )
        return null;
      const leaseId = newId(),
        generation = cache.generation + 1;
      await client(tx)
        .update(truckersCache)
        .set({
          leaseId,
          generation,
          leaseUntil: new Date(now().getTime() + 15000),
          lastAttemptAt: now(),
          steamId: active.steamId,
          identityEpoch: target.identityEpoch,
          ...(!same ? { profile: null, found: null, checkedAt: null, failure: null } : {}),
        })
        .where(eq(truckersCache.userId, actor.userId));
      return { leaseId, generation, steamId: active.steamId, identityEpoch: target.identityEpoch };
    });
    if (!lease) return;
    let result: Awaited<ReturnType<ExternalProviders["truckers"]["lookup"]>> | undefined;
    let failure: ProviderFailure["category"] | null = null;
    try {
      result = await providers.truckers.lookup(lease.steamId);
    } catch (error) {
      failure = error instanceof ProviderFailure ? error.category : "transport";
    }
    await run(async (tx) => {
      const current = await identity.accessState(tx, actor.userId),
        active = await link(tx, actor.userId);
      const [cache] = await client(tx)
        .select()
        .from(truckersCache)
        .where(eq(truckersCache.userId, actor.userId))
        .for("update");
      if (
        !current.active ||
        current.identityEpoch !== lease.identityEpoch ||
        active?.steamId !== lease.steamId ||
        cache?.generation !== lease.generation ||
        cache.leaseId !== lease.leaseId ||
        cache.leaseUntil === null ||
        cache.leaseUntil <= now()
      )
        return;
      await client(tx)
        .update(truckersCache)
        .set({
          leaseId: null,
          leaseUntil: null,
          failure,
          ...(result ? { ...result, checkedAt: now() } : {}),
        })
        .where(eq(truckersCache.userId, actor.userId));
    });
  }
  return {
    async request(actor: Actor, key: string, purpose: "initial" | "replacement") {
      await identity.rateLimit("challenge", actor.userId, "actor");
      return run(async (tx) => {
        const target = await identity.externalContext(tx, actor),
          active = await link(tx, actor.userId);
        const saved = await identity.externalCommand(
          tx,
          `${actor.userId}:steam:${purpose}`,
          id(key),
          {},
          async () => {
            if (target.status !== "active" || (purpose === "initial") === !!active)
              throw identityError(409);
            await client(tx)
              .delete(steamProofs)
              .where(
                and(
                  lt(steamProofs.expiresAt, new Date(now().getTime() - 86400000)),
                  sql`NOT EXISTS (SELECT 1 FROM external_steam_changes WHERE external_steam_changes.proof_id = ${steamProofs.id})`,
                ),
              )
              .limit(100);
            await client(tx)
              .update(steamProofs)
              .set({ state: "invalidated" })
              .where(
                and(
                  eq(steamProofs.userId, actor.userId),
                  eq(steamProofs.purpose, purpose),
                  eq(steamProofs.state, "pending"),
                ),
              );
            await client(tx)
              .update(steamProofs)
              .set({ state: "invalidated" })
              .where(
                and(
                  eq(steamProofs.userId, actor.userId),
                  eq(steamProofs.purpose, purpose),
                  eq(steamProofs.state, "verified"),
                ),
              );
            const proofId = newId();
            await client(tx)
              .insert(steamProofs)
              .values({
                id: proofId,
                userId: actor.userId,
                sessionId: actor.sessionId,
                purpose,
                state: "pending",
                identityEpoch: target.identityEpoch,
                accessEpoch: target.accessEpoch,
                credentialEpoch: target.credentialEpoch,
                emailEpoch: target.emailEpoch,
                previousSteamId: active?.steamId ?? null,
                createdAt: now(),
                expiresAt: new Date(now().getTime() + proofLifetimeMs),
              });
            return { id: proofId };
          },
        );
        const proof = await currentProof(tx, String(saved.id), actor.userId);
        // A same-key result contains only a safe reference, never state/return URLs.
        if (proof.sessionId !== actor.sessionId) throw identityError(409);
        return {
          id: proof.id,
          verificationUrl: authorizationUrl(callback(proof), identity.config.origin),
          expiresAt: proof.expiresAt.toISOString(),
        };
      });
    },
    async callback(actor: Actor, rawQuery: string) {
      let query: URLSearchParams;
      try {
        query = parseAssertion(rawQuery);
      } catch {
        throw identityError(401);
      }
      const proofId = query.get("verificationId") ?? "";
      const proof = await run(async (tx) => {
        const target = await identity.externalContext(tx, actor),
          active = await link(tx, actor.userId),
          proof = await currentProof(tx, proofId, actor.userId);
        if (
          proof.sessionId !== actor.sessionId ||
          proof.state !== "pending" ||
          proof.expiresAt <= now() ||
          !bound(proof, target, active?.steamId ?? null) ||
          !equal(query.get("state") ?? "", state(proof))
        )
          throw identityError(401);
        return proof;
      });
      if (query.get("openid.mode") === "cancel") {
        await run(async (tx) => {
          await identity.externalContext(tx, actor);
          const current = await currentProof(tx, proof.id, actor.userId);
          if (current.state === "pending")
            await client(tx)
              .update(steamProofs)
              .set({ state: "failed" })
              .where(eq(steamProofs.id, proof.id));
        });
        throw identityError(401);
      }
      let verified: { steamId: string; nonce: string };
      try {
        verified = await providers.steam.verify(query, callback(proof), now());
      } catch (error) {
        throw identityError(
          error instanceof ProviderFailure && error.category !== "invalid_response" ? 503 : 401,
        );
      }
      return run(async (tx) => {
        const target = await identity.externalContext(tx, actor),
          active = await link(tx, actor.userId),
          current = await currentProof(tx, proof.id, actor.userId);
        if (
          current.sessionId !== actor.sessionId ||
          current.state !== "pending" ||
          current.expiresAt <= now() ||
          !bound(current, target, active?.steamId ?? null) ||
          Date.parse(verified.nonce.slice(0, 20)) <= now().getTime() - nonceLifetimeMs
        )
          throw identityError(401);
        const candidate = steamId(verified.steamId);
        await client(tx).delete(steamNonces).where(lt(steamNonces.expiresAt, now())).limit(100);
        await client(tx)
          .insert(steamNonces)
          .values({
            hash: digest(`nonce:${verified.nonce}`),
            expiresAt: new Date(now().getTime() + nonceLifetimeMs + 60000),
          });
        await client(tx)
          .update(steamProofs)
          .set({ state: "verified", candidateSteamId: candidate, verifiedAt: now() })
          .where(eq(steamProofs.id, current.id));
        if (current.purpose === "initial")
          return applyLink(
            tx,
            actor.userId,
            target,
            current,
            candidate,
            "member_verified_initial_link",
          );
        return { id: current.id, version: target.version };
      });
    },
    async replace(
      actor: Actor,
      targetId: string,
      key: string,
      expectedVersion: number,
      input: Wire["SteamReplacementInput"],
    ) {
      id(targetId);
      id(input.verificationId);
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 1 ||
        typeof input.reason !== "string" ||
        !input.reason.trim() ||
        input.reason.length > 2048
      )
        throw identityError(422);
      return run(async (tx) => {
        const target = await identity.externalContext(tx, actor, targetId, true);
        return await identity.externalCommand(
          tx,
          `${actor.userId}:steam-replace:${targetId}`,
          id(key),
          { expectedVersion, input },
          async () => {
            if (target.status !== "active") throw identityError(409);
            if (target.version !== expectedVersion) throw identityError(409, "VERSION_CONFLICT");
            const active = await link(tx, targetId),
              proof = await currentProof(tx, input.verificationId, targetId);
            if (
              !active ||
              proof.purpose !== "replacement" ||
              proof.state !== "verified" ||
              !proof.candidateSteamId ||
              proof.expiresAt <= now() ||
              !bound(proof, target, active.steamId) ||
              !(await identity.externalSessionCurrent(tx, proof))
            )
              throw identityError(409);
            return applyLink(tx, actor.userId, target, proof, proof.candidateSteamId, input.reason);
          },
        );
      });
    },
    async inspect(actor: Actor, proofId: string, targetId = actor.userId, staff = false) {
      return run(async (tx) => {
        const target = await identity.externalContext(tx, actor, id(targetId), staff),
          active = await link(tx, targetId),
          proof = await currentProof(tx, proofId, targetId);
        if (proof.purpose !== "replacement") throw identityError(404);
        return projectProof(
          proof,
          target,
          active?.steamId ?? null,
          await identity.externalValidSessions(tx, target, [proof.sessionId]),
        );
      });
    },
    async list(actor: Actor, targetId: string, page: { limit?: number; cursor?: string }) {
      const limit = page.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
      const scope = `cursor:${actor.userId}:${actor.sessionId}:${id(targetId)}:${limit}`;
      let after: string | undefined;
      if (page.cursor) {
        const [value, signature, extra] = page.cursor.split(".");
        if (
          !value ||
          !signature ||
          extra ||
          !equal(signature, digest(`${scope}:${value}`).toString("base64url"))
        )
          throw identityError(422);
        after = id(value);
      }
      return run(async (tx) => {
        const target = await identity.externalContext(tx, actor, targetId, true),
          active = await link(tx, targetId);
        const rows = await client(tx)
          .select()
          .from(steamProofs)
          .where(
            and(
              eq(steamProofs.userId, targetId),
              eq(steamProofs.purpose, "replacement"),
              ...(after ? [gt(steamProofs.id, after)] : []),
            ),
          )
          .orderBy(asc(steamProofs.id))
          .limit(limit + 1);
        const selected = rows.slice(0, limit),
          last = selected.at(-1)?.id;
        const sessions = await identity.externalValidSessions(
          tx,
          target,
          selected.map((proof) => proof.sessionId),
        );
        return {
          items: selected.map((proof) =>
            projectProof(proof, target, active?.steamId ?? null, sessions),
          ),
          nextCursor:
            rows.length > limit && last
              ? `${last}.${digest(`${scope}:${last}`).toString("base64url")}`
              : null,
        };
      });
    },
    async current(actor: Actor) {
      await refresh(actor);
      return snapshot(actor);
    },
    refresh,
    // VTC-023 must invoke this synchronously for every credential use, on its command transaction.
    async credentialEligible(tx: TxContext, credential: ExternalCredential) {
      const current = await identity.accessState(tx, credential.userId),
        active = await link(tx, credential.userId);
      return (
        current.active &&
        active?.steamId === credential.steamId &&
        current.accessEpoch === credential.accessEpoch &&
        current.identityEpoch === credential.identityEpoch &&
        current.credentialEpoch === credential.credentialEpoch
      );
    },
  };
}
export type ExternalIdentities = ReturnType<typeof createExternalIdentities>;
