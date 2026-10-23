import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  newId,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import {
  account,
  and,
  challenges,
  commandResults,
  company,
  eq,
  gt,
  inArray,
  limits,
  lt,
  membership,
  roles,
  session,
  sql,
  user,
} from "@vtc/db/identity-schema";
import {
  engine,
  type IdentityConfig,
  prepareCredential,
  validateIdentityConfig,
  verifySignInCredential,
} from "./engine.js";
import {
  type AssignableRole,
  assignableRoles,
  capabilities,
  type Role,
  requireCapability,
} from "./permissions.js";

type Self = components["schemas"]["Self"];
type Member = typeof membership.$inferSelect;
type Company = typeof company.$inferSelect;
type Purpose = typeof challenges.$inferSelect.purpose;
type SafeResult = Record<string, unknown>;
type Failed = { failure: number };
export interface Actor {
  userId: string;
  sessionId: string;
  accessEpoch: number;
  credentialEpoch: number;
  capabilities: readonly string[];
}
export interface PrivateChallenge {
  id: string;
  userId: string;
  email: string;
  purpose: Purpose;
  code: string;
  expiresAt: string;
  locale?: "en" | "ru";
  emailChangeStage?: "current_email" | "proposed_email";
}
export interface IdentityPorts {
  qualificationsLifecycle?: {
    close(tx: TxContext, userId: string, endedAt: string): Promise<void>;
  };
  invalidateTelemetryCredentials?: (tx: TxContext, userId: string) => Promise<void>;
  steamProjection?: (tx: TxContext, userId: string) => Promise<boolean>;
  // Implementations must persist on this tx and perform network delivery after commit.
  delivery?: {
    enqueue(tx: TxContext, input: PrivateChallenge): Promise<void>;
    invalidate?(
      tx: TxContext,
      input: { userId: string; purpose?: Purpose; generationId?: string },
    ): Promise<void>;
  };
  accessEvents?: {
    append(
      tx: TxContext,
      input: {
        eventId: string;
        type: "member.access_changed";
        userId: string;
        version: number;
        accessEpoch: number;
        identityEpoch: number;
        occurredAt: string;
      },
    ): Promise<void>;
  };
}
export function identityError(statusCode: number, publicCode?: string): Error {
  return Object.assign(new Error("IDENTITY_OPERATION_DENIED"), {
    statusCode,
    ...(publicCode ? { publicCode } : {}),
  });
}
const canonical = (input: unknown): string =>
  JSON.stringify(input, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
const normalizedEmail = (email: string): string => email.toLowerCase();
const isFailure = (value: SafeResult): value is Failed => typeof value.failure === "number";

export function createIdentity(
  unit: UnitOfWork,
  config: IdentityConfig,
  ports: IdentityPorts = {},
  now: () => Date = () => new Date(),
) {
  validateIdentityConfig(config);
  const audit = createAudit(unit);
  function causes(error: unknown): object[] {
    const result: object[] = [];
    let current = error;
    for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
      if (result.includes(current)) break;
      result.push(current);
      current = "cause" in current ? current.cause : null;
    }
    return result;
  }
  function availabilityCategory(error: unknown): string | null {
    for (const current of causes(error)) {
      if ("code" in current) {
        if (
          ["PROTOCOL_SEQUENCE_TIMEOUT", "ETIMEDOUT", "ER_LOCK_WAIT_TIMEOUT"].includes(
            current.code as string,
          )
        )
          return "database_timeout";
        if (
          [
            "ECONNREFUSED",
            "ECONNRESET",
            "EPIPE",
            "PROTOCOL_CONNECTION_LOST",
            "EAI_AGAIN",
            "ENETUNREACH",
            "EHOSTUNREACH",
          ].includes(current.code as string)
        )
          return "database_unavailable";
        if (["ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS"].includes(current.code as string))
          return "database_capacity";
      }
      // mysql2 3.24.6 BasePool.getConnection returns these exact uncoded errors.
      // Queue-limit errors are excluded: this application's pool never queues.
      if (
        current instanceof Error &&
        ["No connections available.", "Pool is closed."].includes(current.message)
      )
        return "database_capacity";
      if (current instanceof Error && current.message === "TRANSACTION_CONTROL_TIMEOUT")
        return "transaction_control_timeout";
    }
    return null;
  }
  function failureCategory(error: unknown): string {
    const availability = availabilityCategory(error);
    if (availability) return availability;
    let current = error;
    for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
      if ("code" in current) {
        if (["PROTOCOL_SEQUENCE_TIMEOUT", "ETIMEDOUT"].includes(String(current.code)))
          return "database_timeout";
        if (
          ["ECONNREFUSED", "ECONNRESET", "PROTOCOL_CONNECTION_LOST"].includes(String(current.code))
        )
          return "database_unavailable";
        if (
          ["ER_DUP_ENTRY", "ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2"].includes(
            String(current.code),
          )
        )
          return "database_constraint";
      }
      if (current instanceof Error && current.message === "TRANSACTION_CONTROL_TIMEOUT")
        return "transaction_control_timeout";
      if (current instanceof Error && current.message === "INACTIVE_OR_FOREIGN_TRANSACTION")
        return "transaction_lifetime";
      current = "cause" in current ? current.cause : null;
    }
    return "unexpected";
  }
  async function run<T>(command: (tx: TxContext) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await unit.run(command);
      } catch (error) {
        const uncertain = causes(error).find(
          (cause) => cause instanceof TransactionCommitOutcomeUnknownError,
        );
        if (uncertain) {
          console.error(
            JSON.stringify({
              event: "identity_operation_failed",
              category: "commit_outcome_unknown",
              causeCategory: failureCategory(error),
            }),
          );
          throw uncertain;
        }
        const availability = availabilityCategory(error);
        if (availability) {
          console.error(
            JSON.stringify({ event: "identity_operation_failed", category: availability }),
          );
          throw identityError(503);
        }
        if (attempt >= 2) throw error;
        let current: unknown = error,
          transient = false;
        for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
          if (
            "code" in current &&
            ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(String(current.code))
          )
            transient = true;
          current = "cause" in current ? current.cause : null;
        }
        if (!transient) {
          if (!(error && typeof error === "object" && "statusCode" in error))
            console.error(
              JSON.stringify({
                event: "identity_operation_failed",
                category: failureCategory(error),
              }),
            );
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }
  const digest = (value: string): Buffer =>
    createHmac("sha256", config.secret).update(value).digest();
  const client = (tx: TxContext) => unit.client(tx);

  async function lockCompany(tx: TxContext): Promise<Company> {
    const [row] = await client(tx)
      .select()
      .from(company)
      .where(eq(company.singleton, 1))
      .for("update");
    if (!row) throw identityError(409, "SETUP_REQUIRED");
    return row;
  }
  async function lockMembers(tx: TxContext, ids: readonly string[]) {
    const result = new Map<string, Member>();
    for (const id of [...new Set(ids)].sort()) {
      const [row] = await client(tx)
        .select()
        .from(membership)
        .where(eq(membership.userId, applicationId(id)))
        .for("update");
      if (row) result.set(id, row);
    }
    return result;
  }
  async function memberRoles(tx: TxContext, id: string, current: Company): Promise<Role[]> {
    const selected: Role[] = (
      await client(tx).select().from(roles).where(eq(roles.userId, id))
    ).map((r) => r.role);
    if (current.directorUserId === id) selected.push("director");
    return selected.sort();
  }
  async function checkActor(
    tx: TxContext,
    actor: Actor,
    current: Company,
    locked?: Member,
  ): Promise<Member> {
    const row = locked ?? (await lockMembers(tx, [actor.userId])).get(actor.userId);
    const [activeSession] = await client(tx)
      .select()
      .from(session)
      .where(and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)))
      .for("update");
    if (
      row?.status !== "active" ||
      !activeSession ||
      activeSession.expiresAt <= now() ||
      row.accessEpoch !== actor.accessEpoch ||
      row.credentialEpoch !== actor.credentialEpoch ||
      activeSession.accessEpoch !== row.accessEpoch ||
      activeSession.credentialEpoch !== row.credentialEpoch
    )
      throw identityError(401);
    actor.capabilities = capabilities(await memberRoles(tx, actor.userId, current));
    return row;
  }
  async function self(
    tx: TxContext,
    id: string,
    current: Company,
  ): Promise<{ data: Self; version: number }> {
    const [row] = await client(tx).select().from(membership).where(eq(membership.userId, id));
    const [identity] = await client(tx).select().from(user).where(eq(user.id, id));
    if (!row || !identity || row.status !== "active") throw identityError(401);
    const assigned = await memberRoles(tx, id, current);
    const steamVerified = (await ports.steamProjection?.(tx, id)) ?? false;
    return {
      version: row.version,
      data: {
        member: { id, nickname: identity.name, formerMember: false, roles: assigned },
        email: identity.email,
        emailVerified: identity.emailVerified,
        capabilities: capabilities(assigned),
        preferences: { locale: row.locale, displayTimezone: row.displayTimezone },
        steamVerified,
        identityEpoch: row.identityEpoch,
        missingSetup: [...(steamVerified ? [] : ["steam"]), "company_reporting_timezone"],
      },
    };
  }
  async function changed(
    tx: TxContext,
    actorId: string | null,
    id: string,
    current: Company,
    operation:
      | "membership.changed"
      | "leadership.transferred"
      | "steam.linked"
      | "steam.replaced" = "membership.changed",
  ) {
    if (!ports.accessEvents) throw identityError(503);
    const [member] = await client(tx).select().from(membership).where(eq(membership.userId, id));
    if (!member) throw identityError(409);
    await audit.append(tx, {
      actorKind: actorId ? "user" : "system",
      actorId,
      operation,
      subjectKind: "user",
      subjectId: id,
      companyId: current.id,
      occurredAt: now().toISOString(),
      reason: actorId ? "operator_request" : "initial_setup",
    });
    await ports.accessEvents.append(tx, {
      eventId: newId(),
      type: "member.access_changed",
      userId: id,
      version: member.version,
      accessEpoch: member.accessEpoch,
      identityEpoch: member.identityEpoch,
      occurredAt: now().toISOString(),
    });
  }
  function validRoles(input: readonly string[]): AssignableRole[] {
    if (
      input.some((role) => !assignableRoles.includes(role as AssignableRole)) ||
      new Set(input).size !== input.length
    )
      throw identityError(422);
    return input as AssignableRole[];
  }
  async function replaceRoles(tx: TxContext, id: string, assigned: readonly string[]) {
    const checked = validRoles(assigned);
    await client(tx).delete(roles).where(eq(roles.userId, id));
    if (checked.length)
      await client(tx)
        .insert(roles)
        .values(checked.map((role) => ({ userId: id, role })));
  }
  async function invalidate(tx: TxContext, row: Member, identityChange = false) {
    await ports.invalidateTelemetryCredentials?.(tx, row.userId);
    await ports.delivery?.invalidate?.(tx, { userId: row.userId });
    await client(tx).delete(session).where(eq(session.userId, row.userId));
    await client(tx)
      .update(challenges)
      .set({ consumed: true })
      .where(eq(challenges.userId, row.userId));
    await client(tx)
      .update(membership)
      .set({
        accessEpoch: row.accessEpoch + 1,
        credentialEpoch: row.credentialEpoch + 1,
        identityEpoch: row.identityEpoch + (identityChange ? 1 : 0),
        version: row.version + 1,
      })
      .where(eq(membership.userId, row.userId));
  }
  async function once(
    tx: TxContext,
    scope: string,
    key: string,
    input: unknown,
    command: () => Promise<SafeResult>,
    persistFailure = false,
  ): Promise<SafeResult> {
    applicationId(key);
    const scopeHash = digest(`scope:${scope}`),
      fingerprint = digest(`input:${canonical(input)}`);
    await client(tx).delete(commandResults).where(lt(commandResults.expiresAt, now())).limit(100);
    const [saved] = await client(tx)
      .select()
      .from(commandResults)
      .where(and(eq(commandResults.scopeHash, scopeHash), eq(commandResults.key, key)))
      .for("update");
    if (saved) {
      if (!timingSafeEqual(saved.fingerprint, fingerprint))
        throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result;
    }
    const result = await command();
    if (!isFailure(result) || persistFailure)
      await client(tx)
        .insert(commandResults)
        .values({
          scopeHash,
          key,
          fingerprint,
          result,
          expiresAt: new Date(now().getTime() + 86400000),
        });
    return result;
  }
  const unwrap = <T extends SafeResult>(result: T): T => {
    if (isFailure(result)) throw identityError(result.failure);
    return result;
  };
  async function issue(
    tx: TxContext,
    member: Member,
    purpose: Purpose,
    successorId: string | null = null,
    proposedEmail: string | null = null,
    currentEmailConfirmed = false,
  ): Promise<SafeResult> {
    if (!ports.delivery) throw identityError(503);
    const [identity] = await client(tx).select().from(user).where(eq(user.id, member.userId));
    if (!identity || (purpose !== "email_verification" && !identity.emailVerified))
      return { failure: 401 };
    const secret = randomBytes(32).toString("base64url"),
      id = newId(),
      expiresAt = new Date(now().getTime() + 600000);
    await ports.delivery.invalidate?.(tx, { userId: member.userId, purpose });
    await client(tx)
      .update(challenges)
      .set({ consumed: true })
      .where(and(eq(challenges.userId, member.userId), eq(challenges.purpose, purpose)));
    // Bound retained generations per account/purpose; result retries contain only safe IDs.
    await client(tx)
      .delete(challenges)
      .where(
        and(
          eq(challenges.userId, member.userId),
          eq(challenges.purpose, purpose),
          eq(challenges.consumed, true),
        ),
      );
    await client(tx)
      .insert(challenges)
      .values({
        id,
        userId: member.userId,
        purpose,
        successorId,
        proposedEmail,
        currentEmailConfirmed,
        identityEpoch: member.identityEpoch,
        emailEpoch: member.emailEpoch,
        accessEpoch: member.accessEpoch,
        credentialEpoch: member.credentialEpoch,
        secretHash: digest(`challenge:${id}:${secret}`),
        expiresAt,
      });
    await ports.delivery.enqueue(tx, {
      id,
      userId: member.userId,
      email: currentEmailConfirmed && proposedEmail ? proposedEmail : identity.email,
      purpose,
      code: purpose === "password_reset" ? `${id}.${secret}` : secret,
      expiresAt: expiresAt.toISOString(),
      locale: member.locale,
      ...(purpose === "email_change"
        ? {
            emailChangeStage: currentEmailConfirmed
              ? ("proposed_email" as const)
              : ("current_email" as const),
          }
        : {}),
    });
    return { id, expiresAt: expiresAt.toISOString(), state: "pending" };
  }
  async function consume(
    tx: TxContext,
    row: Member,
    purpose: Purpose,
    id: string,
    code: string,
    successorId: string | null = null,
    currentEmailConfirmed = false,
  ) {
    const [challenge] = await client(tx)
      .select()
      .from(challenges)
      .where(eq(challenges.id, applicationId(id)))
      .for("update");
    if (
      !challenge ||
      challenge.userId !== row.userId ||
      challenge.purpose !== purpose ||
      (purpose === "email_change" && challenge.currentEmailConfirmed !== currentEmailConfirmed) ||
      challenge.consumed
    )
      return null;
    await client(tx)
      .update(challenges)
      .set({ attempts: Math.min(challenge.attempts + 1, 5) })
      .where(eq(challenges.id, id));
    const valid =
      challenge.expiresAt > now() &&
      challenge.attempts < 5 &&
      challenge.emailEpoch === row.emailEpoch &&
      challenge.identityEpoch === row.identityEpoch &&
      challenge.accessEpoch === row.accessEpoch &&
      challenge.credentialEpoch === row.credentialEpoch &&
      challenge.successorId === successorId &&
      timingSafeEqual(challenge.secretHash, digest(`challenge:${id}:${code}`));
    if (valid || challenge.attempts + 1 >= 5)
      await ports.delivery?.invalidate?.(tx, { userId: row.userId, generationId: id });
    if (!valid) return null;
    await client(tx).update(challenges).set({ consumed: true }).where(eq(challenges.id, id));
    return challenge;
  }

  return {
    config,
    prepareCredential,
    // External identities participates in this transaction host and established failure policy.
    transaction: run,
    externalCommand: once,
    async externalContext(tx: TxContext, actor: Actor, targetId = actor.userId, staff = false) {
      const current = await lockCompany(tx);
      const locked = await lockMembers(tx, [actor.userId, targetId]);
      await checkActor(tx, actor, current, locked.get(actor.userId));
      if (staff) requireCapability(actor, "members.manage");
      else if (targetId !== actor.userId) throw identityError(404);
      const target = locked.get(targetId);
      if (!target) throw identityError(404);
      return { ...target, directorUserId: current.directorUserId };
    },
    async externalSessionCurrent(
      tx: TxContext,
      input: {
        userId: string;
        sessionId: string;
        accessEpoch: number;
        credentialEpoch: number;
        identityEpoch: number;
        emailEpoch: number;
      },
    ) {
      const row = (await lockMembers(tx, [input.userId])).get(input.userId);
      const [found] = await client(tx)
        .select()
        .from(session)
        .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)))
        .for("update");
      return (
        !!row &&
        row.status === "active" &&
        row.accessEpoch === input.accessEpoch &&
        row.identityEpoch === input.identityEpoch &&
        row.credentialEpoch === input.credentialEpoch &&
        row.emailEpoch === input.emailEpoch &&
        !!found &&
        found.expiresAt > now() &&
        found.accessEpoch === row.accessEpoch &&
        found.credentialEpoch === row.credentialEpoch
      );
    },
    async externalValidSessions(
      tx: TxContext,
      target: { userId: string; accessEpoch: number; credentialEpoch: number },
      sessionIds: readonly string[],
    ) {
      const ids = [...new Set(sessionIds)];
      if (ids.length > 100) throw new Error("EXTERNAL_PROOF_PAGE_BOUND_EXCEEDED");
      if (!ids.length) return new Set<string>();
      const rows = await client(tx)
        .select({ id: session.id })
        .from(session)
        .where(
          and(
            eq(session.userId, target.userId),
            eq(session.accessEpoch, target.accessEpoch),
            eq(session.credentialEpoch, target.credentialEpoch),
            gt(session.expiresAt, now()),
            inArray(session.id, ids),
          ),
        );
      return new Set(rows.map((row) => row.id));
    },
    async externalChanged(
      tx: TxContext,
      actorId: string,
      userId: string,
      operation: "steam.linked" | "steam.replaced",
    ) {
      const current = await lockCompany(tx);
      const member = (await lockMembers(tx, [userId])).get(userId);
      if (member?.status !== "active") throw identityError(409);
      await ports.invalidateTelemetryCredentials?.(tx, userId);
      await ports.delivery?.invalidate?.(tx, { userId });
      await client(tx)
        .update(challenges)
        .set({ consumed: true })
        .where(eq(challenges.userId, userId));
      await client(tx)
        .update(membership)
        .set({ identityEpoch: member.identityEpoch + 1, version: member.version + 1 })
        .where(eq(membership.userId, userId));
      await changed(tx, actorId, userId, current, operation);
      return { version: member.version + 1, identityEpoch: member.identityEpoch + 1 };
    },
    // Admissions locks the company before its own rows; no identity table access leaks.
    async onboardingCompany(tx: TxContext, shared = false) {
      if (!shared) return { id: (await lockCompany(tx)).id };
      const [current] = await client(tx)
        .select()
        .from(company)
        .where(eq(company.singleton, 1))
        .for("share");
      if (!current) throw identityError(409, "SETUP_REQUIRED");
      return { id: current.id };
    },
    async emailExists(tx: TxContext, email: string) {
      const [existing] = await client(tx)
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, normalizedEmail(email)))
        .for("share");
      return !!existing;
    },
    async onboardingChanged(tx: TxContext, userId: string) {
      await changed(tx, null, userId, await lockCompany(tx));
    },
    async rateLimit(
      category: "csrf" | "login" | "challenge" | "command" | "read",
      source: string,
      scope: "source" | "actor" = "source",
    ): Promise<void> {
      // Fixed slots prevent unbounded attacker-created identity/IP rows; collisions throttle conservatively.
      const bucket = `${scope}:${category}:${digest(source)[0]}`;
      const allowed = await run(async (tx) => {
        const charge = async (name: string, maximum: number) => {
          const window = Math.floor(now().getTime() / 60000);
          await client(tx)
            .insert(limits)
            .values({ bucket: name, window, count: 0 })
            .onDuplicateKeyUpdate({ set: { bucket: name } });
          const [row] = await client(tx)
            .select()
            .from(limits)
            .where(eq(limits.bucket, name))
            .for("update");
          if (!row) throw identityError(503);
          const count = row.window === window ? row.count + 1 : 1;
          await client(tx)
            .update(limits)
            .set({ window, count: Math.min(count, maximum + 1) })
            .where(eq(limits.bucket, name));
          return count <= maximum;
        };
        // Always lock the source/actor slot before the category's global row.
        // A denied source never spends another source's or category's budget.
        if (!(await charge(bucket, 20))) return false;
        return scope === "actor" || (await charge(`global:${category}`, 200));
      });
      if (!allowed) throw identityError(429);
    },
    async insertWithCredential(
      tx: TxContext,
      input: {
        userId: string;
        email: string;
        name: string;
        passwordHash: string;
        roles: readonly AssignableRole[];
      },
    ): Promise<void> {
      applicationId(input.userId);
      if (
        !input.name ||
        input.name.length > 128 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
        input.email.length > 254 ||
        !input.passwordHash
      )
        throw identityError(422);
      await client(tx)
        .insert(user)
        .values({
          id: input.userId,
          email: normalizedEmail(input.email),
          name: input.name,
          emailVerified: false,
          createdAt: now(),
          updatedAt: now(),
        });
      await client(tx).insert(account).values({
        id: newId(),
        userId: input.userId,
        accountId: input.userId,
        providerId: "credential",
        password: input.passwordHash,
        createdAt: now(),
        updatedAt: now(),
      });
      await client(tx).insert(membership).values({ userId: input.userId, status: "active" });
      await replaceRoles(tx, input.userId, input.roles);
    },
    async bootstrap(input: {
      email: string;
      name: string;
      password: string;
    }): Promise<{ userId: string; companyId: string }> {
      if (!ports.accessEvents) throw identityError(503);
      const credential = await prepareCredential(input.password);
      const userId = newId(),
        companyId = newId();
      return run(async (tx) => {
        const existing = await client(tx).select().from(company).where(eq(company.singleton, 1));
        if (existing.length) throw identityError(409);
        await this.insertWithCredential(tx, {
          userId,
          email: input.email,
          name: input.name,
          ...credential,
          roles: ["driver"],
        });
        await client(tx)
          .insert(company)
          .values({ singleton: 1, id: companyId, directorUserId: userId });
        await changed(tx, null, userId, {
          singleton: 1,
          id: companyId,
          directorUserId: userId,
          version: 1,
        });
        return { userId, companyId };
      });
    },
    async login(email: string, password: string) {
      const normalized = normalizedEmail(email);
      const snapshot = await run(async (tx) => {
        const [identity] = await client(tx).select().from(user).where(eq(user.email, normalized));
        if (!identity) return null;
        const [credential] = await client(tx)
          .select()
          .from(account)
          .where(
            and(
              eq(account.userId, identity.id),
              eq(account.accountId, identity.id),
              eq(account.providerId, "credential"),
            ),
          );
        const [member] = await client(tx)
          .select()
          .from(membership)
          .where(eq(membership.userId, identity.id));
        const [companyState] = await client(tx)
          .select()
          .from(company)
          .where(eq(company.singleton, 1));
        return credential && member && companyState
          ? { identity, credential, member, companyVersion: companyState.version }
          : null;
      });
      // The preflight has committed and released its connection before scrypt.
      // Inactive and absent identities still perform native credential work.
      const bind = (
        identity: typeof user.$inferSelect,
        credential: typeof account.$inferSelect,
        member: Member,
        companyVersion: number,
      ) => ({
        userId: identity.id,
        credentialId: credential.id,
        email: identity.email,
        emailVerified: identity.emailVerified,
        accessEpoch: member.accessEpoch,
        identityEpoch: member.identityEpoch,
        credentialEpoch: member.credentialEpoch,
        emailEpoch: member.emailEpoch,
        companyVersion,
      });
      const proof = await verifySignInCredential(
        snapshot?.credential.password ?? null,
        password,
        config,
        snapshot
          ? bind(snapshot.identity, snapshot.credential, snapshot.member, snapshot.companyVersion)
          : undefined,
      );
      if (!proof || !snapshot || snapshot.member.status !== "active") throw identityError(401);
      return run(async (tx) => {
        const current = await lockCompany(tx);
        const row = (await lockMembers(tx, [snapshot.identity.id])).get(snapshot.identity.id);
        const [identity] = await client(tx)
          .select()
          .from(user)
          .where(eq(user.id, snapshot.identity.id))
          .for("update");
        const [credential] = await client(tx)
          .select()
          .from(account)
          .where(eq(account.id, snapshot.credential.id))
          .for("update");
        if (
          row?.status !== "active" ||
          row.accessEpoch !== snapshot.member.accessEpoch ||
          row.identityEpoch !== snapshot.member.identityEpoch ||
          row.credentialEpoch !== snapshot.member.credentialEpoch ||
          row.emailEpoch !== snapshot.member.emailEpoch ||
          current.version !== snapshot.companyVersion ||
          identity?.email !== normalized ||
          identity.emailVerified !== snapshot.identity.emailVerified ||
          credential?.userId !== snapshot.identity.id ||
          credential.accountId !== snapshot.identity.id ||
          credential.providerId !== "credential" ||
          credential.password !== snapshot.credential.password
        )
          throw identityError(401);
        await client(tx).delete(session).where(lt(session.expiresAt, now())).limit(100);
        const response = await engine(
          client(tx),
          config,
          proof,
          bind(identity, credential, row, current.version),
        ).api.signInEmail({
          body: { email, password },
          asResponse: true,
        });
        if (response.status >= 500) throw identityError(503);
        if ([400, 401, 403].includes(response.status)) throw identityError(401);
        if (!response.ok) throw new Error("AUTH_ENGINE_UNEXPECTED_RESPONSE");
        const body = (await response.json()) as { user: { id: string }; token: string };
        if (body.user.id !== snapshot.identity.id) throw identityError(401);
        await client(tx)
          .update(session)
          .set({
            accessEpoch: row.accessEpoch,
            credentialEpoch: row.credentialEpoch,
            ipAddress: null,
            userAgent: null,
          })
          .where(eq(session.token, body.token));
        return {
          ...(await self(tx, body.user.id, current)),
          cookies: response.headers.getSetCookie(),
        };
      });
    },
    async authenticate(headers: Headers): Promise<Actor> {
      return run(async (tx) => {
        const current = await lockCompany(tx);
        const found = await engine(client(tx), config).api.getSession({
          headers,
          query: { disableRefresh: true },
        });
        if (!found) throw identityError(401);
        const actor: Actor = {
          userId: found.user.id,
          sessionId: found.session.id,
          accessEpoch: found.session.accessEpoch,
          credentialEpoch: found.session.credentialEpoch,
          capabilities: [],
        };
        await checkActor(tx, actor, current);
        return actor;
      });
    },
    async current(actor: Actor) {
      return run(async (tx) => {
        const current = await lockCompany(tx);
        await checkActor(tx, actor, current);
        return self(tx, actor.userId, current);
      });
    },
    async logout(
      actor: Actor,
      headers: Headers,
    ): Promise<{ id: string; version: number; cookies: string[] }> {
      return run(async (tx) => {
        const current = await lockCompany(tx),
          row = await checkActor(tx, actor, current);
        await client(tx)
          .delete(session)
          .where(and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)));
        const native = engine(client(tx), config);
        const cookieHeaders = new Headers(headers);
        const cookieName = (await native.$context).authCookies.sessionToken.name;
        // Native 1.7.10 swallows persistence failures. Use only its cookie expiry
        // path: without its session token it performs no database/provider work.
        // Retain other cookies so the native helper also expires cache chunks.
        const retained = (cookieHeaders.get("cookie") ?? "")
          .split(";")
          .filter((part) => part.split("=", 1)[0]?.trim() !== cookieName)
          .join(";");
        if (retained.trim()) cookieHeaders.set("cookie", retained);
        else cookieHeaders.delete("cookie");
        const response = await native.api.signOut({
          headers: cookieHeaders,
          asResponse: true,
        });
        if (!response.ok) throw new Error("AUTH_ENGINE_COOKIE_CLEAR_FAILED");
        return { id: actor.userId, version: row.version, cookies: response.headers.getSetCookie() };
      });
    },
    async preferences(
      actor: Actor,
      key: string,
      expectedVersion: number,
      input: { locale?: "en" | "ru"; displayTimezone?: string },
    ) {
      if (input.displayTimezone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: input.displayTimezone });
        } catch {
          throw identityError(422);
        }
      }
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            row = await checkActor(tx, actor, current);
          return once(
            tx,
            `${actor.userId}:preferences`,
            key,
            { input, expectedVersion },
            async () => {
              if (row.version !== expectedVersion) throw identityError(409, "VERSION_CONFLICT");
              await client(tx)
                .update(membership)
                .set({ ...input, version: row.version + 1 })
                .where(eq(membership.userId, actor.userId));
              return {
                locale: input.locale ?? row.locale,
                displayTimezone: input.displayTimezone ?? row.displayTimezone,
                version: row.version + 1,
              };
            },
          );
        }),
      );
    },
    async requestChallenge(
      actor: Actor,
      key: string,
      purpose: "email_verification" | "password_change" | "email_change",
      proposedEmail: string | null = null,
    ) {
      if (
        purpose === "email_change" &&
        (!proposedEmail ||
          normalizedEmail(proposedEmail).length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposedEmail))
      )
        throw identityError(422);
      if (!ports.delivery) throw identityError(503);
      await this.rateLimit("challenge", actor.userId, "actor");
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            row = await checkActor(tx, actor, current);
          return once(
            tx,
            `${actor.userId}:challenge:${purpose === "email_verification" ? "verification" : "credentials"}`,
            key,
            { purpose, proposedEmail },
            () =>
              issue(tx, row, purpose, null, proposedEmail ? normalizedEmail(proposedEmail) : null),
          );
        }),
      );
    },
    async confirmChallenge(
      actor: Actor,
      key: string,
      input: {
        purpose: "email_verification" | "password_change" | "email_change";
        challengeId: string;
        code: string;
        newPassword?: string;
      },
    ) {
      const credential =
        input.purpose === "password_change"
          ? await prepareCredential(input.newPassword ?? "")
          : null;
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            row = await checkActor(tx, actor, current);
          return once(
            tx,
            `${actor.userId}:confirm:${input.purpose === "email_verification" ? "verification" : "credentials"}`,
            key,
            input,
            async () => {
              const challenge = await consume(
                tx,
                row,
                input.purpose,
                input.challengeId,
                input.code,
              );
              if (!challenge) return { failure: 401 };
              if (input.purpose === "email_verification") {
                await client(tx)
                  .update(user)
                  .set({ emailVerified: true, updatedAt: now() })
                  .where(eq(user.id, actor.userId));
                await client(tx)
                  .update(membership)
                  .set({ version: row.version + 1 })
                  .where(eq(membership.userId, actor.userId));
              } else {
                if (input.purpose === "email_change") {
                  if (!challenge.proposedEmail) return { failure: 401 };
                  const [identity] = await client(tx)
                    .select()
                    .from(user)
                    .where(eq(user.id, actor.userId));
                  if (identity?.email === challenge.proposedEmail) return { failure: 401 };
                  // The old channel remains authoritative until the separately
                  // delivered proposed-address proof is consumed. A new ID/hash
                  // also prevents an old-channel code from proving the new one.
                  return issue(tx, row, "email_change", null, challenge.proposedEmail, true);
                }
                if (!ports.accessEvents) throw identityError(503);
                if (credential)
                  await client(tx)
                    .update(account)
                    .set({ password: credential.passwordHash, updatedAt: now() })
                    .where(
                      and(eq(account.userId, actor.userId), eq(account.providerId, "credential")),
                    );
                await invalidate(tx, row);
                await changed(tx, actor.userId, actor.userId, current);
              }
              return { id: actor.userId, version: row.version + 1 };
            },
            input.purpose === "email_change",
          );
        }),
      );
    },
    async pendingEmailChange(actor: Actor) {
      return run(async (tx) => {
        const current = await lockCompany(tx),
          row = await checkActor(tx, actor, current);
        const [pending] = await client(tx)
          .select()
          .from(challenges)
          .where(
            and(
              eq(challenges.userId, actor.userId),
              eq(challenges.purpose, "email_change"),
              eq(challenges.consumed, false),
            ),
          );
        return {
          pending:
            pending &&
            pending.proposedEmail &&
            pending.expiresAt > now() &&
            pending.attempts < 5 &&
            pending.emailEpoch === row.emailEpoch &&
            pending.identityEpoch === row.identityEpoch &&
            pending.accessEpoch === row.accessEpoch &&
            pending.credentialEpoch === row.credentialEpoch
              ? {
                  id: pending.id,
                  proposedEmail: pending.proposedEmail,
                  expiresAt: pending.expiresAt.toISOString(),
                  stage: pending.currentEmailConfirmed ? "proposed_email" : "current_email",
                }
              : null,
        };
      });
    },
    async confirmEmailChange(
      actor: Actor,
      key: string,
      input: { challengeId: string; code: string },
    ) {
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            row = await checkActor(tx, actor, current);
          return once(
            tx,
            `${actor.userId}:confirm:proposed-email`,
            key,
            input,
            async () => {
              const challenge = await consume(
                tx,
                row,
                "email_change",
                input.challengeId,
                input.code,
                null,
                true,
              );
              if (!challenge?.proposedEmail) return { failure: 401 };
              const [identity] = await client(tx)
                .select()
                .from(user)
                .where(eq(user.id, actor.userId));
              if (!identity?.emailVerified || identity.email === challenge.proposedEmail)
                return { failure: 401 };
              if (!ports.accessEvents) throw identityError(503);
              try {
                await client(tx)
                  .update(user)
                  .set({ email: challenge.proposedEmail, emailVerified: true, updatedAt: now() })
                  .where(eq(user.id, actor.userId));
              } catch (error) {
                // A duplicate-key statement leaves this InnoDB transaction usable:
                // retain the bounded attempt and generic idempotent failure.
                if (causes(error).some((cause) => "code" in cause && cause.code === "ER_DUP_ENTRY"))
                  return { failure: 401 };
                throw error;
              }
              await client(tx)
                .update(membership)
                .set({ emailEpoch: row.emailEpoch + 1 })
                .where(eq(membership.userId, actor.userId));
              await invalidate(tx, row);
              await changed(tx, actor.userId, actor.userId, current);
              return { id: actor.userId, version: row.version + 1 };
            },
            true,
          );
        }),
      );
    },
    async requestReset(scope: string, key: string, email: string) {
      if (!ports.delivery) throw identityError(503);
      await this.rateLimit("challenge", scope, "actor");
      return unwrap(
        await run(async (tx) => {
          await lockCompany(tx);
          return once(tx, `${scope}:reset-request`, key, { email }, async () => {
            const [identity] = await client(tx)
              .select()
              .from(user)
              .where(eq(user.email, normalizedEmail(email)));
            if (identity) {
              const row = (await lockMembers(tx, [identity.id])).get(identity.id);
              if (row?.status === "active" && identity.emailVerified) {
                const pending = await client(tx)
                  .select()
                  .from(challenges)
                  .where(
                    and(
                      eq(challenges.userId, row.userId),
                      eq(challenges.purpose, "password_reset"),
                      eq(challenges.consumed, false),
                    ),
                  )
                  .for("update");
                // An anonymous binding/key must not replace another caller's
                // usable recovery code or amplify delivery to the same account.
                const usable = pending.some(
                  (challenge) =>
                    challenge.expiresAt > now() &&
                    challenge.attempts < 5 &&
                    challenge.emailEpoch === row.emailEpoch &&
                    challenge.accessEpoch === row.accessEpoch &&
                    challenge.credentialEpoch === row.credentialEpoch &&
                    challenge.identityEpoch === row.identityEpoch,
                );
                if (!usable) await issue(tx, row, "password_reset");
              }
            }
            return { status: "received" };
          });
        }),
      );
    },
    async resetPassword(scope: string, key: string, token: string, password: string) {
      if (!ports.accessEvents) throw identityError(503);
      const credential = await prepareCredential(password),
        [id, code, extra] = token.split(".");
      if (!id || !code || extra !== undefined) throw identityError(401);
      try {
        applicationId(id);
      } catch {
        throw identityError(401);
      }
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx);
          return once(tx, `${scope}:reset`, key, { token, password }, async () => {
            const [lookup] = await client(tx)
              .select()
              .from(challenges)
              .where(eq(challenges.id, applicationId(id)));
            const row = lookup
              ? (await lockMembers(tx, [lookup.userId])).get(lookup.userId)
              : undefined;
            if (row?.status !== "active") return { failure: 401 };
            const [identity] = await client(tx).select().from(user).where(eq(user.id, row.userId));
            if (!identity?.emailVerified || !(await consume(tx, row, "password_reset", id, code)))
              return { failure: 401 };
            await client(tx)
              .update(account)
              .set({ password: credential.passwordHash, updatedAt: now() })
              .where(and(eq(account.userId, row.userId), eq(account.providerId, "credential")));
            await invalidate(tx, row);
            await changed(tx, row.userId, row.userId, current);
            return { id: row.userId, version: row.version + 1 };
          });
        }),
      );
    },
    async administer(
      actor: Actor,
      targetId: string,
      key: string,
      expectedVersion: number,
      input: {
        kind: "roles" | "deactivate" | "reinstate";
        roles?: readonly AssignableRole[];
        qualifications?: readonly unknown[];
      },
    ) {
      if (!ports.accessEvents) throw identityError(503);
      if (input.qualifications?.length) throw identityError(503);
      if (input.kind !== "deactivate" && input.roles === undefined) throw identityError(422);
      if (input.roles) validRoles(input.roles);
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            locked = await lockMembers(tx, [actor.userId, targetId]);
          await checkActor(tx, actor, current, locked.get(actor.userId));
          requireCapability(actor, "members.manage");
          return once(
            tx,
            `${actor.userId}:admin:${targetId}`,
            key,
            { expectedVersion, input },
            async () => {
              const target = locked.get(targetId);
              if (!target) throw identityError(404);
              if (targetId === current.directorUserId) throw identityError(403);
              if (target.version !== expectedVersion) throw identityError(409, "VERSION_CONFLICT");
              if ((input.kind === "reinstate") !== (target.status === "inactive"))
                throw identityError(409);
              if (input.kind === "deactivate")
                await ports.qualificationsLifecycle?.close(tx, targetId, now().toISOString());
              await invalidate(tx, target, input.kind !== "roles");
              await replaceRoles(
                tx,
                targetId,
                input.kind === "deactivate" ? [] : (input.roles ?? []),
              );
              await client(tx)
                .update(membership)
                .set({ status: input.kind === "deactivate" ? "inactive" : "active" })
                .where(eq(membership.userId, targetId));
              await changed(tx, actor.userId, targetId, current);
              return { id: targetId, version: target.version + 1 };
            },
          );
        }),
      );
    },
    async requestSuccession(actor: Actor, successorId: string, key: string) {
      if (!ports.delivery) throw identityError(503);
      await this.rateLimit("challenge", actor.userId, "actor");
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            locked = await lockMembers(tx, [actor.userId, successorId]);
          const row = await checkActor(tx, actor, current, locked.get(actor.userId));
          requireCapability(actor, "leadership.transfer");
          if (actor.userId === successorId || locked.get(successorId)?.status !== "active")
            throw identityError(409);
          return once(tx, `${actor.userId}:succession-request`, key, { successorId }, () =>
            issue(tx, row, "succession", successorId),
          );
        }),
      );
    },
    async confirmSuccession(
      actor: Actor,
      successorId: string,
      challengeId: string,
      code: string,
      key: string,
    ) {
      if (!ports.accessEvents) throw identityError(503);
      return unwrap(
        await run(async (tx) => {
          const current = await lockCompany(tx),
            locked = await lockMembers(tx, [actor.userId, successorId]);
          const row = await checkActor(tx, actor, current, locked.get(actor.userId));
          return once(
            tx,
            `${actor.userId}:succession-confirm`,
            key,
            { successorId, challengeId, code },
            async () => {
              requireCapability(actor, "leadership.transfer");
              if (actor.userId === successorId || locked.get(successorId)?.status !== "active")
                return { failure: 409 };
              const [identity] = await client(tx)
                .select()
                .from(user)
                .where(eq(user.id, actor.userId));
              if (
                !identity?.emailVerified ||
                !(await consume(tx, row, "succession", challengeId, code, successorId))
              )
                return { failure: 401 };
              await client(tx)
                .update(company)
                .set({ directorUserId: successorId, version: current.version + 1 })
                .where(eq(company.singleton, 1));
              await client(tx)
                .insert(roles)
                .values({ userId: actor.userId, role: "driver" })
                .onDuplicateKeyUpdate({ set: { role: "driver" } });
              for (const id of [actor.userId, successorId]) {
                await client(tx)
                  .update(membership)
                  .set({ version: sql`${membership.version} + 1` })
                  .where(eq(membership.userId, id));
                await changed(tx, actor.userId, id, current, "leadership.transferred");
              }
              return { id: current.id, version: current.version + 1 };
            },
          );
        }),
      );
    },
    // Messaging owns no identity tables. Recheck the current bound generation
    // immediately before provider I/O; redemption remains authoritative in flight.
    async deliveryValid(
      tx: TxContext,
      input: {
        id: string;
        userId: string;
        purpose: Purpose;
        stage?: "current_email" | "proposed_email";
      },
    ): Promise<boolean> {
      // Read-only worker grants suffice for shared current reads. Company first
      // also blocks identity writers while this short validity snapshot is read.
      const [current] = await client(tx)
        .select()
        .from(company)
        .where(eq(company.singleton, 1))
        .for("share");
      const [member] = await client(tx)
        .select()
        .from(membership)
        .where(eq(membership.userId, input.userId))
        .for("share");
      const [challenge] = await client(tx)
        .select()
        .from(challenges)
        .where(eq(challenges.id, applicationId(input.id)))
        .for("share");
      const [identity] = await client(tx)
        .select()
        .from(user)
        .where(eq(user.id, input.userId))
        .for("share");
      if (
        !current ||
        !member ||
        member.status !== "active" ||
        !identity ||
        !challenge ||
        challenge.userId !== input.userId ||
        challenge.purpose !== input.purpose ||
        challenge.consumed ||
        challenge.attempts >= 5 ||
        challenge.expiresAt <= now() ||
        challenge.identityEpoch !== member.identityEpoch ||
        challenge.emailEpoch !== member.emailEpoch ||
        challenge.accessEpoch !== member.accessEpoch ||
        challenge.credentialEpoch !== member.credentialEpoch ||
        (input.purpose !== "email_verification" && !identity.emailVerified)
      )
        return false;
      if (
        input.purpose === "email_change" &&
        (challenge.currentEmailConfirmed ? "proposed_email" : "current_email") !== input.stage
      )
        return false;
      if (input.purpose === "succession") {
        if (
          current.directorUserId !== input.userId ||
          !challenge.successorId ||
          challenge.successorId === input.userId
        )
          return false;
        const [successor] = await client(tx)
          .select()
          .from(membership)
          .where(eq(membership.userId, challenge.successorId))
          .for("share");
        if (successor?.status !== "active") return false;
      }
      return true;
    },
    // Company first, then sorted members: shared lock order for promotion and contribution replacement.
    async qualificationContextInTransaction(
      tx: TxContext,
      targetIds: string[],
      actor?: Actor,
      capability = "qualifications.manage",
    ) {
      const current = await lockCompany(tx);
      const locked = await lockMembers(tx, [...targetIds, ...(actor ? [actor.userId] : [])]);
      if (actor) {
        await checkActor(tx, actor, current, locked.get(actor.userId));
        requireCapability(actor, capability);
      }
      for (const id of targetIds) if (!locked.has(id)) throw identityError(404);
      return { companyId: current.id, members: locked };
    },
    async eventContextInTransaction(
      tx: TxContext,
      actor: Actor,
      targetIds: string[] = [],
      capability = "company.read",
    ) {
      const current = await lockCompany(tx);
      const locked = await lockMembers(tx, [...targetIds, actor.userId]);
      await checkActor(tx, actor, current, locked.get(actor.userId));
      requireCapability(actor, capability);
      for (const id of targetIds) if (!locked.has(id)) throw identityError(404);
      return { companyId: current.id, members: locked };
    },
    async eventRosterInTransaction(tx: TxContext, after: string | null, limit: number) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 101)
        throw new Error("EVENT_ROSTER_BOUND_EXCEEDED");
      return client(tx)
        .select({ id: membership.userId })
        .from(membership)
        .where(after ? gt(membership.userId, applicationId(after)) : undefined)
        .orderBy(membership.userId)
        .limit(limit);
    },
    async completeTraineeInTransaction(tx: TxContext, actor: Actor, targetId: string) {
      const current = await lockCompany(tx);
      const locked = await lockMembers(tx, [actor.userId, targetId]);
      await checkActor(tx, actor, current, locked.get(actor.userId));
      requireCapability(actor, "qualifications.manage");
      const member = locked.get(targetId);
      if (member?.status !== "active") throw identityError(409);
      const assigned = await memberRoles(tx, targetId, current);
      if (!assigned.includes("trainee") && assigned.includes("driver")) return;
      await client(tx)
        .delete(roles)
        .where(and(eq(roles.userId, targetId), eq(roles.role, "trainee")));
      if (!assigned.includes("driver"))
        await client(tx).insert(roles).values({ userId: targetId, role: "driver" });
      await client(tx)
        .update(membership)
        .set({ version: member.version + 1 })
        .where(eq(membership.userId, targetId));
      await changed(tx, actor.userId, targetId, current);
    },
    // Transaction-scoped seam for future source/qualification coordinators. Current state is authoritative.
    async authorizeInTransaction(tx: TxContext, actor: Actor, capability: string) {
      const current = await lockCompany(tx);
      const member = await checkActor(tx, actor, current);
      requireCapability(actor, capability);
      return { ...actor, capabilities: [...actor.capabilities], locale: member.locale };
    },
    async memberSummariesInTransaction(tx: TxContext, ids: string[]) {
      const current = await lockCompany(tx);
      if (ids.length > 100) throw new Error("MEMBER_SUMMARY_BOUND_EXCEEDED");
      const unique = [...new Set(ids)].map(applicationId);
      if (!unique.length) return new Map<string, components["schemas"]["MemberSummary"]>();
      const rows = await client(tx)
        .select({ id: user.id, nickname: user.name, status: membership.status })
        .from(user)
        .innerJoin(membership, eq(membership.userId, user.id))
        .where(inArray(user.id, unique))
        .for("share");
      const assigned = await client(tx)
        .select()
        .from(roles)
        .where(inArray(roles.userId, unique))
        .for("share");
      return new Map(
        rows.map((row) => [
          row.id,
          {
            id: row.id,
            nickname: row.nickname,
            formerMember: row.status !== "active",
            roles: [
              ...assigned.filter((r) => r.userId === row.id).map((r) => r.role),
              ...(current.directorUserId === row.id ? ["director" as const] : []),
            ],
          },
        ]),
      );
    },
    async accessState(tx: TxContext, userId: string) {
      const current = await lockCompany(tx);
      const row = (await lockMembers(tx, [userId])).get(userId);
      if (!row) throw identityError(404);
      return {
        active: row.status === "active",
        companyId: current.id,
        canSubmitTrips: capabilities(await memberRoles(tx, userId, current)).includes(
          "trips.submit_own",
        ),
        accessEpoch: row.accessEpoch,
        identityEpoch: row.identityEpoch,
        credentialEpoch: row.credentialEpoch,
      };
    },
  };
}
export type Identity = ReturnType<typeof createIdentity>;
