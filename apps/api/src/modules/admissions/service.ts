import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  applications,
  commandResults,
  decisions,
  desc,
  eq,
  inArray,
  invitations,
  limits,
  lt,
  lte,
  or,
  sql,
} from "@vtc/db/admissions-schema";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { MailIntent } from "../messaging/content.js";
import {
  type AdmissionsConfig,
  type ApplicationInput,
  admissionsSecurity,
  rejectionReason,
  validateApplication,
} from "./security.js";

type App = typeof applications.$inferSelect;
type Invite = typeof invitations.$inferSelect;
type Result = { id: string; version: number; response?: unknown };
export interface AdmissionsPorts {
  identity: Pick<
    Identity,
    | "onboardingCompany"
    | "emailExists"
    | "onboardingChanged"
    | "prepareCredential"
    | "insertWithCredential"
    | "authorizeInTransaction"
  >;
  qualifications: {
    initialize(
      tx: TxContext,
      input: { userId: string; games: readonly ("ets2" | "ats")[]; assignedAt: string },
    ): Promise<void>;
  };
  events: {
    append(
      tx: TxContext,
      input: {
        eventId: string;
        applicationId: string;
        version: number;
        type:
          | "application.submitted"
          | "application.decided"
          | "invitation.reissued"
          | "invitation.redeemed";
        occurredAt: string;
      },
    ): Promise<void>;
  };
  mail?: {
    enqueue(tx: TxContext, input: MailIntent): Promise<string>;
    status(tx: TxContext, id: string): Promise<string>;
  };
  invalidateMail(tx: TxContext, generationId: string): Promise<void>;
}
export async function cleanupAdmissions(
  unit: UnitOfWork,
  enabled: boolean,
  now: () => Date = () => new Date(),
) {
  try {
    await retryTransaction(unit, async (tx) => {
      const at = now().toISOString();
      // Match command lock order: expired results precede invitation rows.
      await unit
        .client(tx)
        .delete(commandResults)
        .where(lte(commandResults.expiresAt, at))
        .limit(100);
      await unit
        .client(tx)
        .update(invitations)
        .set({ ciphertext: null, secretHash: null, payloadExpiresAt: null })
        .where(lte(invitations.payloadExpiresAt, at))
        .limit(100);
    });
    return "completed" as const;
  } catch (error) {
    if (
      enabled ||
      unknownCommit(error) ||
      !causes(error).some(
        (cause) =>
          "code" in cause &&
          ["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(String(cause.code)),
      )
    )
      throw error;
    return "configuration_pending" as const;
  }
}
export function createAdmissions(
  unit: UnitOfWork,
  config: AdmissionsConfig,
  ports: AdmissionsPorts,
  now: () => Date = () => new Date(),
) {
  const crypto = admissionsSecurity(config),
    audit = createAudit(unit),
    client = (tx: TxContext) => unit.client(tx);
  const run = async <T>(command: (tx: TxContext) => Promise<T>): Promise<T> => {
    try {
      return await retryTransaction(unit, command);
    } catch (error) {
      if (
        !unknownCommit(error) &&
        causes(error).some(
          (cause) =>
            ("code" in cause &&
              [
                "ER_LOCK_WAIT_TIMEOUT",
                "ER_CON_COUNT_ERROR",
                "ER_TOO_MANY_USER_CONNECTIONS",
                "PROTOCOL_SEQUENCE_TIMEOUT",
                "ETIMEDOUT",
                "ECONNRESET",
                "ECONNREFUSED",
                "PROTOCOL_CONNECTION_LOST",
                "EPIPE",
                "EAI_AGAIN",
                "ENETUNREACH",
                "EHOSTUNREACH",
              ].includes(String(cause.code))) ||
            (cause instanceof Error &&
              [
                "No connections available.",
                "Pool is closed.",
                "TRANSACTION_CONTROL_TIMEOUT",
              ].includes(cause.message)),
        )
      )
        throw identityError(503);
      throw error;
    }
  };
  const at = () => now().toISOString();
  async function authority(tx: TxContext, actor?: Actor) {
    if (actor) await ports.identity.authorizeInTransaction(tx, actor, "applications.manage");
    return ports.identity.onboardingCompany(tx);
  }
  async function application(tx: TxContext, id: string): Promise<App> {
    const [row] = await client(tx)
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId(id)))
      .for("update");
    if (!row) throw identityError(404);
    return row;
  }
  async function invitation(tx: TxContext, id: string): Promise<{ row: Invite; app: App }> {
    // Company lock serializes domain writers; read the owner before the generation lock.
    const [ref] = await client(tx)
      .select({ applicationId: invitations.applicationId })
      .from(invitations)
      .where(eq(invitations.id, applicationId(id)));
    if (!ref) throw identityError(404);
    const app = await application(tx, ref.applicationId);
    const [row] = await client(tx)
      .select()
      .from(invitations)
      .where(eq(invitations.id, id))
      .for("update");
    if (!row) throw identityError(404);
    return { row, app };
  }
  function active(row: Invite, app: App) {
    return (
      row.state === "active" &&
      row.expiresAt > at() &&
      row.secretHash !== null &&
      row.ciphertext !== null &&
      app.status === "approved" &&
      app.invitationId === row.id
    );
  }
  function match(version: number, expected: number) {
    if (!Number.isSafeInteger(expected) || expected < 1) throw identityError(422);
    if (version !== expected) throw identityError(409, "VERSION_CONFLICT");
  }
  async function once(
    tx: TxContext,
    scope: string,
    key: string,
    input: unknown,
    command: () => Promise<Result>,
  ): Promise<Result> {
    applicationId(key);
    const scopeHash = crypto.digest("scope", scope),
      fingerprint = crypto.digest("command", input);
    await client(tx).delete(commandResults).where(lte(commandResults.expiresAt, at())).limit(100);
    const [saved] = await client(tx)
      .select()
      .from(commandResults)
      .where(and(eq(commandResults.scopeHash, scopeHash), eq(commandResults.key, key)))
      .for("update");
    if (saved) {
      if (!saved.fingerprint.equals(fingerprint)) throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result;
    }
    const result = await command();
    await client(tx)
      .insert(commandResults)
      .values({
        scopeHash,
        key,
        fingerprint,
        result,
        expiresAt: new Date(now().getTime() + 86400000).toISOString(),
      });
    return result;
  }
  async function record(
    tx: TxContext,
    companyId: string,
    actor: Actor | undefined,
    app: App,
    operation:
      | "application.submitted"
      | "application.reviewed"
      | "invitation.reissued"
      | "invitation.redeemed"
      | "invitation.copied",
    subjectId = app.id,
  ) {
    await audit.append(tx, {
      actorKind: actor ? "user" : "system",
      actorId: actor?.userId ?? null,
      operation,
      subjectKind: operation.startsWith("invitation") ? "invitation" : "application",
      subjectId,
      companyId,
      occurredAt: at(),
      reason: actor ? "staff_review" : "initial_setup",
    });
    if (operation !== "invitation.copied")
      await ports.events.append(tx, {
        eventId: newId(),
        applicationId: app.id,
        version: app.version,
        type: operation === "application.reviewed" ? "application.decided" : operation,
        occurredAt: at(),
      });
  }
  async function appDto(
    tx: TxContext,
    row: App,
    prefetched?: typeof decisions.$inferSelect | null,
  ) {
    const decision =
      prefetched !== undefined
        ? prefetched
        : (await client(tx).select().from(decisions).where(eq(decisions.applicationId, row.id)))[0];
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      submittedAt: row.submittedAt,
      fields: {
        nickname: row.nickname,
        email: row.email,
        steamProfileUrl: row.steamProfileUrl,
        games: row.games,
        discord: row.discord,
        introduction: row.introduction,
      },
      decisionReason: decision?.reason ?? null,
      invitationId: row.invitationId,
      decision: decision
        ? {
            id: decision.id,
            outcome: decision.outcome,
            reason: decision.reason,
            reviewerId: decision.reviewerId,
            decidedAt: decision.decidedAt,
            applicationVersion: decision.applicationVersion,
            deliveryId: decision.deliveryId,
          }
        : null,
    };
  }
  async function inviteDto(tx: TxContext, row: Invite) {
    return {
      id: row.id,
      version: row.version,
      applicationId: row.applicationId,
      expiresAt: row.expiresAt,
      state: row.state === "active" && row.expiresAt <= at() ? ("expired" as const) : row.state,
      emailDelivery: row.deliveryId
        ? ((await ports.mail?.status(tx, row.deliveryId)) ?? "unavailable")
        : "not_requested",
      deliveryId: row.deliveryId,
    };
  }
  async function issue(tx: TxContext, app: App): Promise<Invite> {
    const id = newId(),
      secret = crypto.token(),
      token = `${id}.${secret}`,
      createdAt = at(),
      expiresAt = new Date(now().getTime() + 7 * 86400000).toISOString();
    const row: Invite = {
      id,
      applicationId: app.id,
      version: 1,
      state: "active",
      secretHash: crypto.digest("invitation", token),
      ciphertext: crypto.seal(id, app.id, token),
      payloadExpiresAt: expiresAt,
      createdAt,
      expiresAt,
      consumedAt: null,
      userId: null,
      deliveryId: null,
    };
    await client(tx).insert(invitations).values(row);
    await client(tx)
      .update(applications)
      .set({ invitationId: id })
      .where(eq(applications.id, app.id));
    if (ports.mail) {
      row.deliveryId = await ports.mail.enqueue(tx, {
        owner: "admissions",
        generationId: id,
        userId: null,
        kind: "invitation",
        locale: app.locale,
        recipient: app.email,
        expiresAt,
        link: crypto.link(token),
      });
      await client(tx)
        .update(invitations)
        .set({ deliveryId: row.deliveryId })
        .where(eq(invitations.id, id));
    }
    return row;
  }
  async function purge() {
    await cleanupAdmissions(unit, true, now);
  }
  async function charge(
    tx: TxContext,
    bucket: string,
    maximum: number,
    window = Math.floor(now().getTime() / 60000),
  ) {
    await client(tx)
      .insert(limits)
      .values({ bucket, window, count: 0 })
      .onDuplicateKeyUpdate({ set: { bucket } });
    const [row] = await client(tx)
      .select()
      .from(limits)
      .where(eq(limits.bucket, bucket))
      .for("update");
    if (!row) throw identityError(503);
    const count = row.window === window ? Math.min(row.count + 1, maximum + 1) : 1;
    await client(tx).update(limits).set({ window, count }).where(eq(limits.bucket, bucket));
    return count <= maximum;
  }
  return {
    config,
    async rateLimit(category: "submit" | "redeem", source: string) {
      const allowed = await run(async (tx) => {
        const globalBucket = `global:${category}`,
          owned = sql`${limits.bucket} LIKE ${`${category}:%`}`,
          bucket = `${category}:${crypto.digest("source", source).subarray(0, 8).toString("hex")}`;
        // Public allocation locks only its category guard, before every source row.
        await client(tx)
          .insert(limits)
          .values({ bucket: globalBucket, window: 0, count: 0 })
          .onDuplicateKeyUpdate({ set: { bucket: globalBucket } });
        const [global] = await client(tx)
          .select()
          .from(limits)
          .where(eq(limits.bucket, globalBucket))
          .for("update");
        if (!global) throw identityError(503);
        const window = Math.floor(now().getTime() / 60000);
        const globalCount = global.window === window ? global.count : 0;
        // Saturated aggregate admission never allocates an unknown source.
        if (globalCount >= 200) return false;
        await client(tx)
          .delete(limits)
          .where(and(owned, lt(limits.window, window)))
          .limit(100);
        const [existing] = await client(tx)
          .select({ bucket: limits.bucket })
          .from(limits)
          .where(eq(limits.bucket, bucket));
        if (!existing) {
          const occupied = await client(tx)
            .select({ bucket: limits.bucket })
            .from(limits)
            .where(owned)
            .limit(256);
          if (occupied.length >= 256) return false;
        }
        if (!(await charge(tx, bucket, 20, window))) return false;
        await client(tx)
          .update(limits)
          .set({ window, count: globalCount + 1 })
          .where(eq(limits.bucket, globalBucket));
        return true;
      });
      if (!allowed) throw identityError(429);
    },
    async admitStaff(actor: Actor, category: "staff_read" | "staff_command") {
      const allowed = await run(async (tx) => {
        // Current authority precedes quota mutation; the company lock serializes slot allocation.
        await authority(tx, actor);
        const window = Math.floor(now().getTime() / 60000),
          owned = sql`${limits.bucket} LIKE ${`${category}:%`}`,
          bucket = `${category}:${crypto.digest("staff-actor", actor.userId).subarray(0, 8).toString("hex")}`;
        await client(tx)
          .delete(limits)
          .where(and(owned, lt(limits.window, window)))
          .limit(100);
        const [existing] = await client(tx)
          .select({ bucket: limits.bucket })
          .from(limits)
          .where(eq(limits.bucket, bucket));
        if (!existing) {
          const occupied = await client(tx)
            .select({ bucket: limits.bucket })
            .from(limits)
            .where(owned)
            .limit(256);
          if (occupied.length >= 256) return false;
        }
        return charge(tx, bucket, 20, window);
      });
      if (!allowed) throw identityError(429);
    },
    async submit(scope: string, key: string, raw: ApplicationInput, locale: "en" | "ru" = "en") {
      const input = validateApplication(raw);
      if (!["en", "ru"].includes(locale)) throw identityError(422);
      return run(async (tx) => {
        const company = await authority(tx);
        return once(tx, `public:${scope}:submit`, key, { input, locale }, async () => {
          const receipt = { id: newId(), version: 1 },
            emailKey = input.email.toLowerCase();
          const [open] = await client(tx)
            .select({ id: applications.id })
            .from(applications)
            .where(eq(applications.openEmail, emailKey))
            .for("update");
          if (open || (await ports.identity.emailExists(tx, emailKey))) return receipt;
          const row: App = {
            id: newId(),
            version: 1,
            status: "submitted",
            submittedAt: at(),
            nickname: input.nickname,
            locale,
            email: input.email,
            emailKey,
            openEmail: emailKey,
            steamProfileUrl: input.steamProfileUrl,
            games: input.games,
            discord: input.discord,
            introduction: input.introduction,
            invitationId: null,
          };
          await client(tx).insert(applications).values(row);
          await record(tx, company.id, undefined, row, "application.submitted");
          return receipt;
        });
      });
    },
    async list(
      actor: Actor,
      options: {
        limit?: number;
        cursor?: string;
        historyId?: string;
        status?: "submitted" | "approved" | "rejected";
      } = {},
    ) {
      return run(async (tx) => {
        await authority(tx, actor);
        const limit = options.limit ?? 25;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
        const parent = options.historyId ? await application(tx, options.historyId) : null;
        const binding = `${actor.userId}:${actor.sessionId}:${actor.accessEpoch}:applications:${parent?.id ?? "all"}:${parent?.emailKey ?? "all"}:${options.status ?? "all"}:${limit}:manage:v2`;
        const cursor = options.cursor ? crypto.readCursor(binding, options.cursor) : null;
        const rows = await client(tx)
          .select()
          .from(applications)
          .where(
            and(
              parent ? eq(applications.emailKey, parent.emailKey) : undefined,
              options.status ? eq(applications.status, options.status) : undefined,
              cursor
                ? or(
                    lt(applications.submittedAt, cursor.at),
                    and(eq(applications.submittedAt, cursor.at), lt(applications.id, cursor.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(applications.submittedAt), desc(applications.id))
          .limit(limit + 1);
        const selected = rows.slice(0, limit),
          last = selected.at(-1);
        const history = selected.length
          ? await client(tx)
              .select()
              .from(decisions)
              .where(
                inArray(
                  decisions.applicationId,
                  selected.map((row) => row.id),
                ),
              )
          : [];
        const byApplication = new Map(history.map((row) => [row.applicationId, row]));
        return {
          items: await Promise.all(
            selected.map((row) => appDto(tx, row, byApplication.get(row.id) ?? null)),
          ),
          nextCursor:
            rows.length > limit && last ? crypto.cursor(binding, last.submittedAt, last.id) : null,
        };
      });
    },
    async detail(actor: Actor, id: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        return appDto(tx, await application(tx, id));
      });
    },
    async decide(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      input: { decision: "approve" } | { decision: "reject"; reason: string },
    ) {
      if (!["approve", "reject"].includes(input.decision)) throw identityError(422);
      if (input.decision === "reject") rejectionReason(input.reason);
      return run(async (tx) => {
        const company = await authority(tx, actor);
        const result = await once(
          tx,
          `${actor.userId}:decide:${id}`,
          key,
          { expected, input },
          async () => {
            const app = await application(tx, id);
            match(app.version, expected);
            if (app.status !== "submitted") throw identityError(409);
            const decisionId = newId();
            let deliveryId: string | null = null;
            await client(tx)
              .update(applications)
              .set({
                status: input.decision === "approve" ? "approved" : "rejected",
                version: app.version + 1,
                ...(input.decision === "reject" ? { openEmail: null } : {}),
              })
              .where(eq(applications.id, id));
            await client(tx)
              .insert(decisions)
              .values({
                applicationId: id,
                id: decisionId,
                outcome: input.decision,
                reason: input.decision === "reject" ? input.reason : null,
                reviewerId: actor.userId,
                decidedAt: at(),
                applicationVersion: app.version,
                deliveryId: null,
              });
            if (input.decision === "reject") {
              if (!ports.mail) throw identityError(503);
              deliveryId = await ports.mail.enqueue(tx, {
                owner: "admissions",
                generationId: decisionId,
                userId: null,
                kind: "rejection",
                locale: app.locale,
                recipient: app.email,
                expiresAt: new Date(now().getTime() + 7 * 86400000).toISOString(),
                reason: input.reason,
              });
            } else {
              if (await ports.identity.emailExists(tx, app.emailKey)) throw identityError(409);
              await issue(tx, app);
            }
            if (deliveryId)
              await client(tx)
                .update(decisions)
                .set({ deliveryId })
                .where(eq(decisions.applicationId, id));
            await record(
              tx,
              company.id,
              actor,
              { ...app, version: app.version + 1 },
              "application.reviewed",
            );
            return {
              id,
              version: app.version + 1,
              response: {
                version: app.version + 1,
                invitationId: (await application(tx, id)).invitationId,
              },
            };
          },
        );
        return {
          ...(await appDto(tx, await application(tx, id))),
          ...(result.response as { version: number; invitationId: string | null }),
        };
      });
    },
    async inspect(actor: Actor, id: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        return inviteDto(tx, (await invitation(tx, id)).row);
      });
    },
    async copy(actor: Actor, id: string, expected: number) {
      return run(async (tx) => {
        const company = await authority(tx, actor),
          { row, app } = await invitation(tx, id);
        match(row.version, expected);
        if (!active(row, app) || !row.ciphertext) throw identityError(409);
        const token = crypto.open(row.id, app.id, row.ciphertext);
        if (!crypto.digest("invitation", token).equals(row.secretHash as Buffer))
          throw identityError(503);
        await record(tx, company.id, actor, app, "invitation.copied", row.id);
        return { invitationId: row.id, link: crypto.link(token), expiresAt: row.expiresAt };
      });
    },
    async requestEmail(actor: Actor, id: string, key: string, expected: number) {
      return run(async (tx) => {
        await authority(tx, actor);
        const result = await once(
          tx,
          `${actor.userId}:invitation-email:${id}`,
          key,
          { expected },
          async () => {
            const { row, app } = await invitation(tx, id);
            match(row.version, expected);
            if (!active(row, app) || row.deliveryId) throw identityError(409);
            if (!ports.mail || !row.ciphertext) throw identityError(503);
            const token = crypto.open(row.id, app.id, row.ciphertext);
            if (!crypto.digest("invitation", token).equals(row.secretHash as Buffer))
              throw identityError(503);
            const deliveryId = await ports.mail.enqueue(tx, {
              owner: "admissions",
              generationId: row.id,
              userId: null,
              kind: "invitation",
              locale: app.locale,
              recipient: app.email,
              expiresAt: row.expiresAt,
              link: crypto.link(token),
            });
            const next = { ...row, deliveryId, version: row.version + 1 };
            await client(tx)
              .update(invitations)
              .set({ deliveryId, version: next.version })
              .where(eq(invitations.id, id));
            return { id, version: next.version, response: await inviteDto(tx, next) };
          },
        );
        return result.response as Awaited<ReturnType<typeof inviteDto>>;
      });
    },
    async reissue(actor: Actor, id: string, key: string, expected: number) {
      return run(async (tx) => {
        const company = await authority(tx, actor);
        const result = await once(
          tx,
          `${actor.userId}:reissue:${id}`,
          key,
          { expected },
          async () => {
            const { row, app } = await invitation(tx, id);
            match(row.version, expected);
            if (row.state !== "active" || app.status !== "approved" || app.invitationId !== id)
              throw identityError(409);
            if (await ports.identity.emailExists(tx, app.emailKey)) throw identityError(409);
            await client(tx)
              .update(invitations)
              .set({
                state: "revoked",
                version: row.version + 1,
                ciphertext: null,
                secretHash: null,
                payloadExpiresAt: null,
              })
              .where(eq(invitations.id, id));
            await ports.invalidateMail(tx, id);
            const replacement = await issue(tx, app);
            await client(tx)
              .update(applications)
              .set({ version: app.version + 1 })
              .where(eq(applications.id, app.id));
            await record(
              tx,
              company.id,
              actor,
              { ...app, version: app.version + 1 },
              "invitation.reissued",
              replacement.id,
            );
            return { id: replacement.id, version: 1, response: await inviteDto(tx, replacement) };
          },
        );
        return result.response as Awaited<ReturnType<typeof inviteDto>>;
      });
    },
    async redeem(scope: string, key: string, token: string, password: string) {
      if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) throw identityError(409);
      let id: string;
      try {
        id = applicationId(token.slice(0, 36));
      } catch {
        throw identityError(409);
      }
      const credential = await ports.identity.prepareCredential(password);
      return run(async (tx) => {
        const company = await authority(tx);
        return once(tx, `public:${scope}:redeem:${id}`, key, { token, password }, async () => {
          const { row, app } = await invitation(tx, id);
          if (!active(row, app) || !row.secretHash?.equals(crypto.digest("invitation", token)))
            throw identityError(409);
          if (await ports.identity.emailExists(tx, app.emailKey)) throw identityError(409);
          const userId = newId();
          await ports.identity.insertWithCredential(tx, {
            userId,
            email: app.emailKey,
            name: app.nickname,
            ...credential,
            roles: ["trainee"],
          });
          await ports.qualifications.initialize(tx, { userId, games: app.games, assignedAt: at() });
          await client(tx)
            .update(invitations)
            .set({
              state: "used",
              version: row.version + 1,
              userId,
              consumedAt: at(),
              ciphertext: null,
              secretHash: null,
              payloadExpiresAt: null,
            })
            .where(eq(invitations.id, id));
          await ports.invalidateMail(tx, id);
          await client(tx)
            .update(applications)
            .set({ version: app.version + 1, openEmail: null })
            .where(eq(applications.id, app.id));
          await record(
            tx,
            company.id,
            undefined,
            { ...app, version: app.version + 1 },
            "invitation.redeemed",
            id,
          );
          await ports.identity.onboardingChanged(tx, userId);
          return { id: userId, version: 1 };
        });
      });
    },
    async deliveryValid(
      tx: TxContext,
      input: { generationId: string; kind: "invitation" | "rejection" },
    ) {
      await ports.identity.onboardingCompany(tx, true);
      if (input.kind === "rejection") {
        const [decision] = await client(tx)
          .select({ outcome: decisions.outcome })
          .from(decisions)
          .where(eq(decisions.id, applicationId(input.generationId)))
          .for("share");
        return decision?.outcome === "reject";
      }
      // Read-only worker grants use shared locks in the same company/application/generation order.
      const [reference] = await client(tx)
        .select({ applicationId: invitations.applicationId })
        .from(invitations)
        .where(eq(invitations.id, applicationId(input.generationId)));
      if (!reference) return false;
      const [app] = await client(tx)
        .select()
        .from(applications)
        .where(eq(applications.id, reference.applicationId))
        .for("share");
      const [row] = await client(tx)
        .select()
        .from(invitations)
        .where(eq(invitations.id, input.generationId))
        .for("share");
      return !!app && !!row && active(row, app);
    },
    purge,
  };
}
export type Admissions = ReturnType<typeof createAdmissions>;
export async function notificationAdmissionState(unit: UnitOfWork, tx: TxContext, id: string) {
  const [row] = await unit
    .client(tx)
    .select({ version: applications.version, status: applications.status })
    .from(applications)
    .where(eq(applications.id, applicationId(id)))
    .for("share");
  if (!row) throw new Error("NOTIFICATION_APPLICATION_MISSING");
  return row;
}
