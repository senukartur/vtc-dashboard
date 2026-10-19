import { randomBytes } from "node:crypto";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import {
  applications,
  commandResults,
  decisions,
  eq,
  invitations,
  sql,
} from "@vtc/db/admissions-schema";
import { account, membership } from "@vtc/db/identity-schema";
import { mailDeliveries } from "@vtc/db/messaging-schema";
import { initialQualifications } from "@vtc/db/qualifications-schema";
import { getTableName } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  type ApplicationInput,
  admissionsSecurity,
} from "../../apps/api/src/modules/admissions/security.ts";
import {
  type Admissions,
  type AdmissionsPorts,
  createAdmissions,
} from "../../apps/api/src/modules/admissions/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { mailCrypto } from "../../apps/api/src/modules/messaging/content.ts";
import { localProvider, type MailProvider } from "../../apps/api/src/modules/messaging/provider.ts";
import {
  createMessaging,
  invalidateAdmissionsMail,
  type Messaging,
} from "../../apps/api/src/modules/messaging/service.ts";
import { createQualificationInitialization } from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  admissionsEvents,
  identityAccessEvents,
} from "../../apps/api/src/platform/outbox/events.ts";
import { guardedSettings, reset, testConnection } from "../persistence/support.ts";
import { bounded, deferred } from "../support/concurrency.ts";

const origin = "http://127.0.0.1:4173",
  password = "Synthetic-onboarding-passphrase-42";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const config = { key: randomBytes(32).toString("base64url"), origin };
const mailConfig = {
  mode: "local" as const,
  key: randomBytes(32).toString("hex"),
  sender: "sender@example.invalid",
  origin,
  production: false,
};
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  admissions: Admissions,
  messaging: Messaging,
  director: Actor;
let instant = Date.now();
const time = () => new Date(instant);
function failAfterInsert(tableName: string) {
  let writes = 0;
  function after(builder: object): object {
    return new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "then" && typeof value === "function")
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(target as PromiseLike<unknown>)
              .then(() => {
                writes++;
                throw new Error("SYNTHETIC_POST_WRITE_FAILURE");
              })
              .then(resolve, reject);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = Reflect.apply(value, target, args);
          return next && typeof next === "object" ? after(next) : next;
        };
      },
    });
  }
  const failing: UnitOfWork = {
    run: (command) => unit.run(command),
    close: async () => {},
    client(tx) {
      const original = unit.client(tx);
      return new Proxy(original, {
        get(target, property) {
          if (property === "insert")
            return (table: Parameters<typeof target.insert>[0]) => {
              const builder = target.insert(table);
              return getTableName(table) === tableName ? after(builder) : builder;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  return { unit: failing, writes: () => writes };
}
function harness(
  options: {
    mail?: boolean;
    provider?: MailProvider;
    unit?: UnitOfWork;
    overrides?: Partial<AdmissionsPorts>;
  } = {},
) {
  const u = options.unit ?? unit;
  let owner: Admissions;
  const auth = createIdentity(u, identityConfig, { accessEvents: identityAccessEvents(u) }, time);
  const mail = createMessaging(
    u,
    mailConfig,
    options.provider ?? localProvider(),
    {
      identityValid: (tx, input) => auth.deliveryValid(tx, input),
      admissionsValid: (tx, input) => owner.deliveryValid(tx, input),
      authorize: async (tx, actor, scope) => {
        await auth.authorizeInTransaction(
          tx,
          actor,
          scope === "admissions" ? "applications.manage" : "company.read",
        );
      },
    },
    time,
  );
  owner = createAdmissions(
    u,
    config,
    {
      identity: auth,
      qualifications: createQualificationInitialization(u),
      events: admissionsEvents(u),
      invalidateMail: (tx, id) => invalidateAdmissionsMail(u, tx, id, time),
      ...(options.mail === false
        ? {}
        : {
            mail: {
              enqueue: mail.enqueue,
              status: mail.admissionsStatus,
            },
          }),
      ...options.overrides,
    },
    time,
  );
  return { identity: auth, admissions: owner, messaging: mail };
}
const input = (email = `${newId()}@example.invalid`): ApplicationInput => ({
  nickname: "Fictional Applicant",
  email,
  steamProfileUrl: "https://steamcommunity.com/id/fictional-driver",
  games: ["ets2", "ats"],
});
async function status(work: Promise<unknown>) {
  try {
    await work;
    return 200;
  } catch (error) {
    return error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : 500;
  }
}
async function submitted(owner = admissions, raw = input(), locale: "en" | "ru" = "en") {
  await owner.submit(`pre:${newId()}`, newId(), raw, locale);
  const [app] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(applications)
      .where(eq(applications.openEmail, raw.email.toLowerCase()))
      .orderBy(sql`${applications.submittedAt} DESC`, sql`${applications.id} DESC`)
      .limit(1),
  );
  if (!app) throw new Error("SYNTHETIC_APPLICATION_MISSING");
  return app;
}
async function approved(owner = admissions, raw = input()) {
  const app = await submitted(owner, raw);
  const decided = await owner.decide(director, app.id, newId(), 1, { decision: "approve" });
  if (!decided.invitationId) throw new Error("SYNTHETIC_INVITATION_MISSING");
  const link = await owner.copy(director, decided.invitationId, 1);
  const token = new URL(link.link).searchParams.get("token");
  if (!token) throw new Error("SYNTHETIC_TOKEN_MISSING");
  return { app, invitationId: decided.invitationId, token, link };
}
async function count(table: string, where = "", values: string[] = []) {
  // Only fixed test-owned identifiers from the allowlist enter this diagnostic query.
  if (
    ![
      "identity_users",
      "identity_accounts",
      "identity_memberships",
      "identity_roles",
      "identity_sessions",
      "qualification_initial_assignments",
      "admissions_decisions",
      "admissions_invitations",
      "admissions_applications",
      "admissions_command_results",
      "admissions_limits",
      "outbox_events",
      "mail_deliveries",
    ].includes(table)
  )
    throw new Error("SYNTHETIC_TABLE_DENIED");
  const [result] = await control.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM ${table} ${where}`,
    values,
  );
  return Number(result[0]?.n);
}
beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  await runMigrations(guardedSettings());
  unit = createUnitOfWork(guardedSettings());
  ({ identity, admissions, messaging } = harness());
  await identity.bootstrap({
    email: "admissions-director@example.invalid",
    name: "Fictional Director",
    password,
  });
  const login = await identity.login("admissions-director@example.invalid", password);
  director = await identity.authenticate(
    new Headers({ cookie: login.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
  );
  // Keep this synthetic administrative session valid while testing invitation-clock boundaries.
  await control.execute(
    "UPDATE identity_sessions SET expires_at=UTC_TIMESTAMP(3)+INTERVAL 30 DAY WHERE id=?",
    [director.sessionId],
  );
});
beforeEach(async () => {
  instant = Date.now();
  await control.query("DELETE FROM admissions_limits");
  await control.query("DELETE FROM identity_limits");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("public duplicates preserve immutable evidence and return only binding-owned receipts; exact replay conflicts on changed input", async () => {
  const raw = input(),
    scope = `pre:${newId()}`,
    key = newId();
  const [a, b] = await Promise.all([
    admissions.submit(scope, key, raw),
    admissions.submit(scope, key, raw),
  ]);
  expect(a).toEqual(b);
  expect(Object.keys(a).sort()).toEqual(["id", "version"]);
  expect(
    await status(admissions.submit(scope, key, { ...raw, nickname: "Different Fictional" })),
  ).toBe(409);
  const duplicate = await admissions.submit(`pre:${newId()}`, newId(), {
    ...raw,
    nickname: "Cannot Replace",
  });
  expect(duplicate.id).not.toBe(a.id);
  const saved = await unit.run((tx) =>
    unit.client(tx).select().from(applications).where(eq(applications.emailKey, raw.email)),
  );
  expect(saved.length).toBe(1);
  expect(saved[0]?.nickname).toBe(raw.nickname);
  expect(saved[0]?.id).not.toBe(a.id);
  const changedBinding = await admissions.submit(`pre:${newId()}`, key, raw);
  expect(changedBinding.id).not.toBe(a.id);
  expect(await status(admissions.submit(scope, newId(), { ...raw, games: [] }))).toBe(422);
});
test("actual messaging approval/rejection enqueue atomically, preserves RU intent/history and reapplication", async () => {
  const app = await submitted(admissions, input(), "ru"),
    key = newId();
  const rejected = await admissions.decide(director, app.id, key, 1, {
    decision: "reject",
    reason: "Fictional review reason",
  });
  expect(rejected.status).toBe("rejected");
  expect(rejected.decision?.reviewerId).toBe(director.userId);
  expect(rejected.decision?.decidedAt).toBe(time().toISOString());
  const [decision] = await unit.run((tx) =>
    unit.client(tx).select().from(decisions).where(eq(decisions.applicationId, app.id)),
  );
  const [mail] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, decision?.deliveryId as string)),
  );
  if (!mail?.ciphertext) throw new Error("SYNTHETIC_PRIVATE_MAIL_MISSING");
  const privateMail = mailCrypto(mailConfig.key).open(mail.id, mail.ciphertext);
  expect(privateMail.intent.locale).toBe("ru");
  expect(privateMail.intent.reason).toBe("Fictional review reason");
  expect(privateMail.request.subject).toBe("Ваша заявка в компанию");
  const repeated = await admissions.decide(director, app.id, key, 1, {
    decision: "reject",
    reason: "Fictional review reason",
  });
  expect(repeated.decision?.id).toBe(rejected.decision?.id);
  const reapplied = await submitted(admissions, input(app.email));
  expect(reapplied.id).not.toBe(app.id);
  const history = await admissions.list(director, { historyId: app.id, limit: 1 });
  expect(history.items.length).toBe(1);
  expect(Boolean(history.nextCursor)).toBe(true);
  const next = await admissions.list(director, {
    historyId: app.id,
    limit: 1,
    cursor: history.nextCursor as string,
  });
  expect(next.items.length).toBe(1);
  expect(next.items[0]?.id).not.toBe(history.items[0]?.id);
  expect(await status(admissions.list(director, { cursor: history.nextCursor as string }))).toBe(
    422,
  );
  expect(
    await unit.run((tx) =>
      admissions.deliveryValid(tx, { generationId: decision?.id as string, kind: "rejection" }),
    ),
  ).toBe(true);
  const ru = await submitted(admissions, input(), "ru");
  const accepted = await admissions.decide(director, ru.id, newId(), 1, { decision: "approve" });
  const invitation = await admissions.inspect(director, accepted.invitationId as string);
  expect(invitation.emailDelivery).toBe("queued");
  const [invitationMail] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, invitation.deliveryId as string)),
  );
  expect(
    mailCrypto(mailConfig.key).open(
      invitationMail?.id as string,
      invitationMail?.ciphertext as string,
    ).intent.locale,
  ).toBe("ru");
});
test("disabled mail preserves seven-day copy and redemption; rejection fails closed without changing decision", async () => {
  const noMail = harness({ mail: false }).admissions,
    fixture = await approved(noMail);
  const invite = await noMail.inspect(director, fixture.invitationId);
  expect(invite.emailDelivery).toBe("not_requested");
  expect(Date.parse(invite.expiresAt) - Date.parse(fixture.app.submittedAt)).toBe(7 * 86400000);
  const app = await submitted(noMail);
  expect(
    await status(
      noMail.decide(director, app.id, newId(), 1, { decision: "reject", reason: "Fictional" }),
    ),
  ).toBe(503);
  expect((await noMail.detail(director, app.id)).status).toBe("submitted");
  const redeemed = await noMail.redeem("pre:disabled", newId(), fixture.token, password);
  expect(redeemed.version).toBe(1);
  expect(await count("identity_sessions", "WHERE user_id=?", [redeemed.id])).toBe(0);
  expect(await status(noMail.copy(director, fixture.invitationId, 2))).toBe(409);
});
test.each([
  ["approve", "approve"],
  ["approve", "reject"],
] as const)(
  "concurrent %s/%s makes exactly one immutable decision/generation",
  async (first, second) => {
    const app = await submitted();
    const results = await Promise.all([
      status(admissions.decide(director, app.id, newId(), 1, { decision: first })),
      status(
        admissions.decide(
          director,
          app.id,
          newId(),
          1,
          second === "reject"
            ? { decision: "reject", reason: "Fictional" }
            : { decision: "approve" },
        ),
      ),
    ]);
    expect(results.sort()).toEqual([200, 409]);
    expect(await count("admissions_decisions", "WHERE application_id=?", [app.id])).toBe(1);
    expect(
      await count("admissions_invitations", "WHERE application_id=?", [app.id]),
    ).toBeLessThanOrEqual(1);
  },
);
test("concurrent redemption is atomic and normal native sign-in reads its credential; same-key lost response replays", async () => {
  const f = await approved(),
    key = newId(),
    scope = `pre:${newId()}`;
  const [a, b] = await Promise.all([
    admissions.redeem(scope, key, f.token, password),
    admissions.redeem(scope, key, f.token, password),
  ]);
  expect(a).toEqual(b);
  const q = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(initialQualifications)
      .where(eq(initialQualifications.userId, a.id)),
  );
  expect(q.map((r) => r.game).sort()).toEqual(["ats", "ets2"]);
  expect(q.every((r) => r.level === "trainee" && r.assignedAt === time().toISOString())).toBe(true);
  expect(await count("identity_accounts", "WHERE user_id=?", [a.id])).toBe(1);
  expect(await count("identity_memberships", "WHERE user_id=?", [a.id])).toBe(1);
  expect(await count("identity_sessions", "WHERE user_id=?", [a.id])).toBe(0);
  const login = await identity.login(f.app.email, password);
  expect(login.data.emailVerified).toBe(false);
  expect(login.data.member.roles).toEqual(["trainee"]);
  expect(await status(admissions.redeem(scope, newId(), f.token, password))).toBe(409);
  expect(await status(admissions.redeem(scope, key, f.token, `${password}changed`))).toBe(409);
  const [invite] = await unit.run((tx) =>
    unit.client(tx).select().from(invitations).where(eq(invitations.id, f.invitationId)),
  );
  expect(invite?.ciphertext).toBe(null);
  expect(invite?.secretHash).toBe(null);
  const f2 = await approved();
  const results = await Promise.all([
    status(admissions.redeem("pre:different", newId(), f2.token, password)),
    status(admissions.redeem("pre:different", newId(), f2.token, password)),
  ]);
  expect(results.sort()).toEqual([200, 409]);
});
test.each([["ets2"], ["ats"]] as ("ets2" | "ats")[][])(
  "initial qualification is confined to selected game %s",
  async (game) => {
    const f = await approved(admissions, { ...input(), games: [game] });
    const r = await admissions.redeem("pre:game", newId(), f.token, password);
    const q = await unit.run((tx) =>
      unit
        .client(tx)
        .select()
        .from(initialQualifications)
        .where(eq(initialQualifications.userId, r.id)),
    );
    expect(q.map((row) => row.game)).toEqual([game]);
  },
);
test("reissue removes old hash/ciphertext/mail and copy, redeemer and worker reject replaced/expired generations", async () => {
  const f = await approved();
  const old = await admissions.inspect(director, f.invitationId);
  const replacement = await admissions.reissue(director, f.invitationId, newId(), 1);
  expect(replacement.id).not.toBe(f.invitationId);
  expect(await status(admissions.redeem("pre:old", newId(), f.token, password))).toBe(409);
  expect(await status(admissions.copy(director, f.invitationId, 2))).toBe(409);
  const staleMail = await messaging.inspect(director, old.deliveryId as string);
  expect(staleMail.state).toBe("suppressed");
  expect(
    await unit.run((tx) =>
      admissions.deliveryValid(tx, { generationId: f.invitationId, kind: "invitation" }),
    ),
  ).toBe(false);
  const copy = await admissions.copy(director, replacement.id, 1);
  const token = new URL(copy.link).searchParams.get("token") as string;
  const saved = instant;
  instant = Date.parse(replacement.expiresAt) - 1;
  expect((await admissions.copy(director, replacement.id, 1)).link).toBe(copy.link);
  instant++;
  expect(await status(admissions.copy(director, replacement.id, 1))).toBe(409);
  expect(await status(admissions.redeem("pre:expiry", newId(), token, password))).toBe(409);
  await admissions.purge();
  const [expired] = await unit.run((tx) =>
    unit.client(tx).select().from(invitations).where(eq(invitations.id, replacement.id)),
  );
  expect(expired?.ciphertext).toBe(null);
  expect(expired?.secretHash).toBe(null);
  expect((await admissions.detail(director, f.app.id)).status).toBe("approved");
  instant = saved;
});
test("copy/reissue and redeem/reissue races preserve a single current generation without stale success after replacement", async () => {
  const f = await approved();
  const results = await Promise.allSettled([
    admissions.reissue(director, f.invitationId, newId(), 1),
    admissions.redeem("pre:race", newId(), f.token, password),
  ]);
  expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
  const f2 = await approved();
  const copy = admissions.copy(director, f2.invitationId, 1);
  const replacement = admissions.reissue(director, f2.invitationId, newId(), 1);
  await Promise.allSettled([copy, replacement]);
  expect(await status(admissions.copy(director, f2.invitationId, 2))).toBe(409);
});
test.each([
  "identity_accounts",
  "identity_memberships",
  "identity_roles",
  "qualification_initial_assignments",
  "audit_entries",
  "outbox_events",
] as const)(
  "failure at %s rolls back account/member/qualification/consumption and original token stays usable",
  async (table) => {
    const f = await approved(),
      before = await count("identity_users");
    const failure = failAfterInsert(table),
      h = harness({ unit: failure.unit });
    expect(await status(h.admissions.redeem("pre:rollback", newId(), f.token, password))).toBe(500);
    expect(failure.writes()).toBe(1);
    expect(await count("identity_users")).toBe(before);
    const invite = await admissions.inspect(director, f.invitationId);
    expect(invite.state).toBe("active");
    expect(invite.version).toBe(1);
    expect((await admissions.redeem("pre:rollback", newId(), f.token, password)).version).toBe(1);
  },
);
test.each(["approve", "reject"] as const)(
  "mail enqueue failure rolls back %s and leaves application undecided",
  async (decision) => {
    const app = await submitted();
    const failure = failAfterInsert("mail_deliveries"),
      h = harness({ unit: failure.unit });
    expect(
      await status(
        h.admissions.decide(
          director,
          app.id,
          newId(),
          1,
          decision === "approve" ? { decision } : { decision, reason: "Fictional" },
        ),
      ),
    ).toBe(500);
    expect(failure.writes()).toBe(1);
    expect((await admissions.detail(director, app.id)).status).toBe("submitted");
    expect(await count("admissions_decisions", "WHERE application_id=?", [app.id])).toBe(0);
    expect(await count("admissions_invitations", "WHERE application_id=?", [app.id])).toBe(0);
  },
);
test.each(["active", "inactive"] as const)(
  "existing %s identity, including changed case, is never adopted or recredentialed",
  async (membershipStatus) => {
    const raw = input(),
      prepared = await identity.prepareCredential(password),
      id = newId();
    await unit.run(async (tx) => {
      await identity.insertWithCredential(tx, {
        userId: id,
        email: raw.email,
        name: "Existing Fictional",
        roles: ["driver"],
        ...prepared,
      });
      if (membershipStatus === "inactive")
        await unit
          .client(tx)
          .update(membership)
          .set({ status: "inactive" })
          .where(eq(membership.userId, id));
    });
    const before = await count("admissions_applications");
    await admissions.submit("pre:existing", newId(), { ...raw, email: raw.email.toUpperCase() });
    expect(await count("admissions_applications")).toBe(before);
    const [credential] = await unit.run((tx) =>
      unit.client(tx).select().from(account).where(eq(account.userId, id)),
    );
    expect(credential?.password === prepared.passwordHash).toBe(true);
    const f = await approved(),
      newPrepared = await identity.prepareCredential(password);
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: newId(),
        email: f.app.email.toUpperCase(),
        name: "Late Existing Fictional",
        roles: ["driver"],
        ...newPrepared,
      }),
    );
    expect(await status(admissions.redeem("pre:existing-race", newId(), f.token, password))).toBe(
      409,
    );
  },
);
test("current director/deputy parity; every other role and inactive/stale sessions fail all staff operations", async () => {
  const f = await approved();
  async function member(assigned: ("trainee" | "driver" | "dispatcher" | "deputy_director")[]) {
    const id = newId(),
      email = `${id}@example.invalid`;
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: id,
        email,
        name: "Fictional Permission",
        roles: assigned,
        passwordHash: "nonfunctional-test-hash",
      }),
    );
    const sessionId = newId();
    await control.execute(
      "INSERT INTO identity_sessions(id,token,user_id,expires_at,created_at,updated_at,access_epoch,credential_epoch) VALUES (?,?,?,UTC_TIMESTAMP(3)+INTERVAL 1 DAY,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1,1)",
      [sessionId, newId(), id],
    );
    return { userId: id, sessionId, accessEpoch: 1, credentialEpoch: 1, capabilities: [] } as Actor;
  }
  const deputy = await member(["deputy_director"]);
  expect((await admissions.detail(deputy, f.app.id)).id).toBe(f.app.id);
  expect((await admissions.copy(deputy, f.invitationId, 1)).invitationId).toBe(f.invitationId);
  const pending = await submitted();
  expect(
    (
      await admissions.decide(deputy, pending.id, newId(), 1, {
        decision: "reject",
        reason: "Fictional",
      })
    ).status,
  ).toBe("rejected");
  for (const assigned of [["trainee"], ["driver"], ["dispatcher"], []] as (
    | "trainee"
    | "driver"
    | "dispatcher"
  )[][]) {
    const actor = await member(assigned);
    const methods = [
      () => admissions.list(actor),
      () => admissions.list(actor, { historyId: f.app.id }),
      () => admissions.detail(actor, f.app.id),
      () => admissions.inspect(actor, f.invitationId),
      () => admissions.copy(actor, f.invitationId, 1),
      () => admissions.reissue(actor, f.invitationId, newId(), 1),
      () => admissions.decide(actor, f.app.id, newId(), 2, { decision: "approve" }),
    ];
    for (const method of methods) expect(await status(method())).toBe(403);
  }
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ accessEpoch: 2 })
      .where(eq(membership.userId, deputy.userId)),
  );
  expect(await status(admissions.list(deputy))).toBe(401);
  const staleOperations = [
    () => admissions.list(deputy, { historyId: f.app.id }),
    () => admissions.detail(deputy, f.app.id),
    () => admissions.inspect(deputy, f.invitationId),
    () => admissions.copy(deputy, f.invitationId, 1),
    () => admissions.reissue(deputy, f.invitationId, newId(), 1),
    () => admissions.decide(deputy, f.app.id, newId(), 2, { decision: "approve" }),
  ];
  for (const operation of staleOperations) expect(await status(operation())).toBe(401);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, deputy.userId)),
  );
  expect(await status(admissions.copy(deputy, f.invitationId, 1))).toBe(401);
  for (const operation of staleOperations) expect(await status(operation())).toBe(401);
});

test("mail rejected/ambiguous/simulated outcomes never prevent valid manual copy and safe status follows actual evidence", async () => {
  for (const outcome of ["rejected", "ambiguous", "simulated"] as const) {
    let sends = 0;
    const provider: MailProvider = {
      mode: "local",
      scope: `synthetic:${outcome}`,
      send: async () => {
        sends++;
        return outcome === "rejected"
          ? { state: "rejected", category: "authentication", retryAfterMs: null }
          : outcome === "ambiguous"
            ? { state: "ambiguous", category: "acceptance_unknown" }
            : { state: "simulated", receipt: "nonfunctional-synthetic-receipt" };
      },
    };
    const h = harness({ provider }),
      f = await approved(h.admissions),
      invite = await h.admissions.inspect(director, f.invitationId);
    await h.messaging.handler
      .external?.(
        { deliveryId: invite.deliveryId },
        `messaging.mail:${invite.deliveryId}`,
        new AbortController().signal,
        { remainingMs: () => 20000 },
      )
      .catch(() => {});
    expect(sends).toBe(1);
    expect(Boolean((await h.admissions.copy(director, f.invitationId, 1)).link)).toBe(true);
    expect((await h.admissions.inspect(director, f.invitationId)).emailDelivery).toBe(
      outcome === "rejected" ? "failed" : outcome,
    );
  }
});
test("worker current validity suppresses mail replaced/consumed before its fence; inspect/resend use matching lock order", async () => {
  let sends = 0;
  const h = harness({
    provider: {
      mode: "local",
      scope: "synthetic:fence",
      send: async () => {
        sends++;
        return { state: "simulated", receipt: "nonfunctional-synthetic" };
      },
    },
  });
  const f = await approved(h.admissions),
    invite = await h.admissions.inspect(director, f.invitationId);
  await h.admissions.reissue(director, f.invitationId, newId(), 1);
  await h.messaging.handler.external?.(
    { deliveryId: invite.deliveryId },
    `messaging.mail:${invite.deliveryId}`,
    new AbortController().signal,
    { remainingMs: () => 20000 },
  );
  expect(sends).toBe(0);
  const current = await approved(h.admissions),
    delivery = await h.admissions.inspect(director, current.invitationId);
  await h.admissions.redeem("pre:worker", newId(), current.token, password);
  await Promise.all([
    h.messaging.inspect(director, delivery.deliveryId as string),
    h.messaging.handler.external?.(
      { deliveryId: delivery.deliveryId },
      `messaging.mail:${delivery.deliveryId}`,
      new AbortController().signal,
      { remainingMs: () => 20000 },
    ),
  ]);
  expect(sends).toBe(0);
  expect(
    await status(h.messaging.resend(director, delivery.deliveryId as string, newId(), 2)),
  ).toBe(409);
  const fresh = await approved(h.admissions),
    entered = deferred<void>(),
    release = deferred<void>();
  const shared = unit.run(async (tx) => {
    expect(
      await h.admissions.deliveryValid(tx, {
        generationId: fresh.invitationId,
        kind: "invitation",
      }),
    ).toBe(true);
    entered.resolve();
    await bounded(release.promise, "admissions_worker_release", 3000);
  });
  await bounded(entered.promise, "admissions_worker_entered");
  const replacing = h.admissions.reissue(director, fresh.invitationId, newId(), 1);
  release.resolve();
  await Promise.all([shared, replacing]);
  expect(
    await unit.run((tx) =>
      h.admissions.deliveryValid(tx, { generationId: fresh.invitationId, kind: "invitation" }),
    ),
  ).toBe(false);
});
test("bounded persistent rate categories isolate public submission/redemption and deny before parsing/auth/password work", async () => {
  const source = "synthetic-flood";
  for (let n = 0; n < 20; n++) await admissions.rateLimit("submit", source);
  for (let n = 0; n < 205; n++)
    expect(await status(harness().admissions.rateLimit("submit", source))).toBe(429);
  await admissions.rateLimit("redeem", source);
  await admissions.admitStaff(director, "staff_read");
  const [global] = await control.query<RowDataPacket[]>(
    "SELECT count FROM admissions_limits WHERE bucket='global:submit'",
  );
  expect(Number(global[0]?.count)).toBe(20);
  const security = admissionsSecurity(config),
    sourceSlot = security.digest("source", source)[0];
  let distinct = "";
  for (let i = 0; i < 20000; i++) {
    const candidate = `synthetic-old-byte-collision:${i}`;
    if (security.digest("source", candidate)[0] === sourceSlot) {
      distinct = candidate;
      break;
    }
  }
  expect(Boolean(distinct)).toBe(true);
  expect(
    security
      .digest("source", distinct)
      .subarray(0, 8)
      .equals(security.digest("source", source).subarray(0, 8)),
  ).toBe(false);
  for (let n = 0; n < 20; n++) await admissions.rateLimit("submit", distinct);
  expect(await status(admissions.rateLimit("submit", distinct))).toBe(429);
  const [afterCollision] = await control.query<RowDataPacket[]>(
    "SELECT count FROM admissions_limits WHERE bucket='global:submit'",
  );
  expect(Number(afterCollision[0]?.count)).toBe(40);
  expect(await count("admissions_limits")).toBeLessThanOrEqual(1026);
  await control.query("DELETE FROM admissions_limits");
  for (let n = 0; n < 20; n++) await admissions.rateLimit("redeem", "127.0.0.1");
  const app = await createApp({ identity, admissions, checkReadiness: async () => true }),
    crypto = vi.spyOn(identity, "prepareCredential"),
    auth = vi.spyOn(identity, "authenticate");
  try {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/public/invitation-redemptions",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(r.statusCode).toBe(429);
    expect(auth.mock.calls.length).toBe(0);
    expect(crypto.mock.calls.length).toBe(0);
  } finally {
    await app.close();
    crypto.mockRestore();
    auth.mockRestore();
  }
  const saved = instant;
  instant += 60000;
  await admissions.rateLimit("submit", source);
  instant = saved;
});

test("public aggregate denial stays early and bounded for thousands of unknown sources without spending staff budgets", async () => {
  for (let i = 0; i < 200; i++) await admissions.rateLimit("redeem", `synthetic-distributed:${i}`);
  expect(await count("admissions_limits")).toBe(201);
  const recreated = harness().admissions;
  for (let i = 0; i < 2000; i++)
    expect(await status(recreated.rateLimit("redeem", `synthetic-global-denied:${i}`))).toBe(429);
  expect(await count("admissions_limits")).toBe(201);
  const [aggregate] = await control.query<RowDataPacket[]>(
    "SELECT count FROM admissions_limits WHERE bucket='global:redeem'",
  );
  expect(Number(aggregate[0]?.count)).toBe(200);
  const app = await createApp({
    identity,
    admissions: recreated,
    checkReadiness: async () => true,
  });
  const auth = vi.spyOn(identity, "authenticate"),
    credential = vi.spyOn(identity, "prepareCredential");
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/invitation-redemptions",
      remoteAddress: "203.0.113.100",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(response.statusCode).toBe(429);
    expect(auth.mock.calls.length).toBe(0);
    expect(credential.mock.calls.length).toBe(0);
    expect(await count("admissions_limits")).toBe(201);
    await admissions.admitStaff(director, "staff_read");
    await admissions.rateLimit("submit", "synthetic-independent-submit");
  } finally {
    auth.mockRestore();
    credential.mockRestore();
    await app.close();
  }
});

test("public source allocation has a strict cap, atomic last-slot races and bounded category-local window cleanup", async () => {
  const security = admissionsSecurity(config),
    window = Math.floor(instant / 60000);
  await control.query("INSERT INTO admissions_limits(bucket,`window`,count) VALUES ?", [
    ["submit", "redeem"].flatMap((category) => [
      ...Array.from({ length: 256 }, (_, i) => [
        `${category}:${i.toString(16).padStart(16, "0")}`,
        window,
        0,
      ]),
      [`global:${category}`, window, 0],
    ]),
  ]);
  expect(await count("admissions_limits")).toBe(514);
  expect(await status(admissions.rateLimit("submit", "synthetic-no-capacity"))).toBe(429);
  expect(await count("admissions_limits")).toBe(514);
  await control.execute("DELETE FROM admissions_limits WHERE bucket='submit:0000000000000000'");
  const contenders = ["synthetic-last-slot-a", "synthetic-last-slot-b"];
  const race = await Promise.all(
    contenders.map((source) => status(harness().admissions.rateLimit("submit", source))),
  );
  expect([...race].sort()).toEqual([200, 429]);
  expect(await count("admissions_limits")).toBe(514);
  const winner = contenders[race.indexOf(200)] as string;
  await harness().admissions.rateLimit("submit", winner);
  const bucket = `submit:${security.digest("source", winner).subarray(0, 8).toString("hex")}`;
  const [charged] = await control.execute<RowDataPacket[]>(
    "SELECT count FROM admissions_limits WHERE bucket=?",
    [bucket],
  );
  expect(Number(charged[0]?.count)).toBe(2);
  const saved = instant;
  instant += 60000;
  try {
    await control.execute("UPDATE admissions_limits SET `window`=?,count=0 WHERE bucket=?", [
      window + 1,
      bucket,
    ]);
    await admissions.rateLimit("submit", winner);
    expect(await count("admissions_limits", "WHERE bucket LIKE 'submit:%'")).toBe(156);
    expect(await count("admissions_limits", "WHERE bucket LIKE 'redeem:%'")).toBe(256);
    const [global] = await control.query<RowDataPacket[]>(
      "SELECT count FROM admissions_limits WHERE bucket='global:submit'",
    );
    expect(Number(global[0]?.count)).toBe(1);
    await harness().admissions.rateLimit("submit", winner);
    expect(await count("admissions_limits", "WHERE bucket LIKE 'submit:%'")).toBe(56);
    await admissions.rateLimit("submit", winner);
    expect(await count("admissions_limits", "WHERE bucket LIKE 'submit:%'")).toBe(1);
  } finally {
    instant = saved;
  }
});

test("public category guards proceed while company authority is locked and coexist with staff admission", async () => {
  const entered = deferred<void>(),
    release = deferred<void>();
  const holding = unit.run(async (tx) => {
    await identity.onboardingCompany(tx);
    entered.resolve();
    await release.promise;
  });
  await bounded(entered.promise, "public_admission_company_locked");
  try {
    await bounded(
      Promise.all([
        admissions.rateLimit("submit", "synthetic-company-independent"),
        admissions.rateLimit("redeem", "synthetic-company-independent"),
      ]),
      "public_admission_without_company_lock",
    );
  } finally {
    release.resolve();
    await holding;
  }
  await Promise.all([
    admissions.rateLimit("submit", "synthetic-cross-category"),
    admissions.rateLimit("redeem", "synthetic-cross-category"),
    admissions.admitStaff(director, "staff_read"),
  ]);
  expect(await count("admissions_limits")).toBe(7);
});

test("anonymous and unauthorized HTTP floods cannot charge staff quotas; current staff quotas follow users across sessions and recreation", async () => {
  const prepared = await identity.prepareCredential(password);
  async function signedIn(roles: ("trainee" | "driver" | "dispatcher" | "deputy_director")[]) {
    const userId = newId(),
      email = `${userId}@example.invalid`;
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email,
        name: "Fictional Admission Guard",
        roles,
        ...prepared,
      }),
    );
    const login = await identity.login(email, password);
    const cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
    return { cookie, actor: await identity.authenticate(new Headers({ cookie })) };
  }
  const unauthorized = [
    await signedIn(["trainee"]),
    await signedIn(["driver"]),
    await signedIn(["dispatcher"]),
    await signedIn([]),
  ];
  const stale = await signedIn(["deputy_director"]),
    inactive = await signedIn(["deputy_director"]);
  await control.execute(
    "UPDATE identity_memberships SET access_epoch=access_epoch+1 WHERE user_id=?",
    [stale.actor.userId],
  );
  await control.execute("UPDATE identity_memberships SET status='inactive' WHERE user_id=?", [
    inactive.actor.userId,
  ]);
  const deputy = await signedIn(["deputy_director"]),
    fixture = await approved();
  const app = await createApp({ identity, admissions, checkReadiness: async () => true });
  const auth = vi.spyOn(identity, "authenticate");
  try {
    for (let i = 0; i < 205; i++) {
      for (const method of ["GET", "POST"] as const) {
        const response = await app.inject({
          method,
          remoteAddress: `192.0.2.${(i % 254) + 1}`,
          url:
            method === "GET"
              ? "/api/v1/admin/applications"
              : `/api/v1/admin/invitations/${fixture.invitationId}/copy-link`,
          ...(method === "POST"
            ? { headers: { "content-type": "application/json" }, payload: "{" }
            : {}),
        });
        expect(response.statusCode).toBe(401);
      }
    }
    expect(auth.mock.calls.length).toBe(0);
    for (let i = 0; i < 205; i++)
      expect(
        (
          await app.inject({
            url: "/api/v1/admin/applications",
            remoteAddress: `198.51.100.${i + 1}`,
            headers: { cookie: "vtc_dev_session=nonfunctional-invalid-signature" },
          })
        ).statusCode,
      ).toBe(401);
    for (const [i, current] of [...unauthorized, stale, inactive].entries()) {
      for (let request = 0; request < 35; request++) {
        for (const method of ["GET", "POST"] as const) {
          const response = await app.inject({
            method,
            url:
              method === "GET"
                ? "/api/v1/admin/applications"
                : `/api/v1/admin/invitations/${fixture.invitationId}/copy-link`,
            headers: { cookie: current.cookie, "content-type": "application/json" },
            ...(method === "POST" ? { payload: "{" } : {}),
          });
          expect(response.statusCode).toBe(i < unauthorized.length ? 403 : 401);
        }
      }
    }
    expect(await count("admissions_limits")).toBe(0);
    const cookies = await Promise.all(
      [0, 1].map(async () => {
        const login = await identity.login("admissions-director@example.invalid", password);
        return login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
      }),
    );
    const directorActors = await Promise.all(
      cookies.map((cookie) => identity.authenticate(new Headers({ cookie }))),
    );
    const directorActor = directorActors[0] as Actor;
    const command = (cookie: string, actor: Actor) =>
      app.inject({
        method: "POST",
        url: `/api/v1/admin/invitations/${fixture.invitationId}/copy-link`,
        headers: {
          cookie,
          origin,
          "x-csrf-token": csrfProtection(identityConfig).issue({}, actor).token,
          "if-match": '"v1"',
        },
      });
    for (let n = 0; n < 20; n++) {
      auth.mockClear();
      expect(
        (
          await app.inject({
            url: "/api/v1/admin/applications",
            headers: { cookie: cookies[n % 2] as string },
          })
        ).statusCode,
      ).toBe(200);
      expect(auth.mock.calls.length).toBe(1);
      auth.mockClear();
      expect(
        (await command(cookies[n % 2] as string, directorActors[n % 2] as Actor)).statusCode,
      ).toBe(200);
      expect(auth.mock.calls.length).toBe(1);
    }
    expect(
      (
        await app.inject({
          url: "/api/v1/admin/applications",
          headers: { cookie: cookies[1] as string },
        })
      ).statusCode,
    ).toBe(429);
    expect((await command(cookies[0] as string, directorActor)).statusCode).toBe(429);
    expect(await status(harness().admissions.admitStaff(directorActor, "staff_read"))).toBe(429);
    expect(
      (await app.inject({ url: "/api/v1/admin/applications", headers: { cookie: deputy.cookie } }))
        .statusCode,
    ).toBe(200);
    expect((await command(deputy.cookie, deputy.actor)).statusCode).toBe(200);
    expect(await count("admissions_limits")).toBe(4);
    const [buckets] = await control.query<RowDataPacket[]>("SELECT bucket FROM admissions_limits");
    expect(buckets.every((r) => /^staff_(read|command):[0-9a-f]{16}$/.test(String(r.bucket)))).toBe(
      true,
    );
  } finally {
    auth.mockRestore();
    await app.close();
  }
});

test("staff rate allocation and bounded old-window cleanup stay atomic at the strict per-category cap", async () => {
  const security = admissionsSecurity(config),
    window = Math.floor(instant / 60000);
  const bucket = `staff_read:${security.digest("staff-actor", director.userId).subarray(0, 8).toString("hex")}`;
  for (const category of ["staff_read", "staff_command"] as const)
    await control.query("INSERT INTO admissions_limits(bucket,`window`,count) VALUES ?", [
      Array.from({ length: 256 }, (_, i) => [
        `${category}:${i.toString(16).padStart(16, "0")}`,
        window,
        1,
      ]),
    ]);
  await control.query("INSERT INTO admissions_limits(bucket,`window`,count) VALUES ?", [
    ["submit", "redeem"].flatMap((category) => [
      ...Array.from({ length: 256 }, (_, i) => [
        `${category}:${i.toString(16).padStart(16, "0")}`,
        window,
        0,
      ]),
      [`global:${category}`, window, 0],
    ]),
  ]);
  expect(await count("admissions_limits")).toBe(1026);
  expect(await status(admissions.admitStaff(director, "staff_read"))).toBe(429);
  expect(await status(admissions.admitStaff(director, "staff_command"))).toBe(429);
  expect(await count("admissions_limits")).toBe(1026);
  await control.execute("DELETE FROM admissions_limits WHERE bucket='staff_read:0000000000000000'");
  for (let batch = 0; batch < 4; batch++) {
    const outcomes = await Promise.all(
      Array.from({ length: 2 }, () =>
        status(harness().admissions.admitStaff(director, "staff_read")),
      ),
    );
    expect(outcomes.every((code) => code === 200)).toBe(true);
  }
  expect(await count("admissions_limits")).toBe(1026);
  const [charged] = await control.execute<RowDataPacket[]>(
    "SELECT count FROM admissions_limits WHERE bucket=?",
    [bucket],
  );
  expect(Number(charged[0]?.count)).toBe(8);
  const userId = newId(),
    sessionId = newId();
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email: `${userId}@example.invalid`,
      name: "Fictional Slot Competitor",
      roles: ["deputy_director"],
      passwordHash: "nonfunctional-test-hash",
    }),
  );
  await control.execute(
    "INSERT INTO identity_sessions(id,token,user_id,expires_at,created_at,updated_at,access_epoch,credential_epoch) VALUES (?,?,?,UTC_TIMESTAMP(3)+INTERVAL 1 DAY,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1,1)",
    [sessionId, newId(), userId],
  );
  const competitor: Actor = {
    userId,
    sessionId,
    accessEpoch: 1,
    credentialEpoch: 1,
    capabilities: [],
  };
  await control.execute("DELETE FROM admissions_limits WHERE bucket=?", [bucket]);
  const contenders = [director, competitor];
  const race = await Promise.all(
    contenders.map((actor) => status(harness().admissions.admitStaff(actor, "staff_read"))),
  );
  expect([...race].sort()).toEqual([200, 429]);
  expect(await count("admissions_limits")).toBe(1026);
  const winner = contenders[race.indexOf(200)] as Actor;
  const winnerBucket = `staff_read:${security.digest("staff-actor", winner.userId).subarray(0, 8).toString("hex")}`;
  const saved = instant;
  instant += 60000;
  try {
    // Keep this actor current while measuring exactly100 old rows removed per pass.
    await control.execute("UPDATE admissions_limits SET `window`=?,count=0 WHERE bucket=?", [
      window + 1,
      winnerBucket,
    ]);
    await admissions.admitStaff(winner, "staff_read");
    expect(await count("admissions_limits", "WHERE bucket LIKE 'staff_read:%'")).toBe(156);
    expect(await count("admissions_limits", "WHERE bucket LIKE 'staff_command:%'")).toBe(256);
    const [fresh] = await control.execute<RowDataPacket[]>(
      "SELECT count FROM admissions_limits WHERE bucket=?",
      [winnerBucket],
    );
    expect(Number(fresh[0]?.count)).toBe(1);
    await harness().admissions.admitStaff(winner, "staff_read");
    expect(await count("admissions_limits", "WHERE bucket LIKE 'staff_read:%'")).toBe(56);
    await admissions.admitStaff(winner, "staff_read");
    expect(await count("admissions_limits", "WHERE bucket LIKE 'staff_read:%'")).toBe(1);
  } finally {
    instant = saved;
  }
});
test("strict HTTP optional fields, invalid facts, Origin/CSRF, bounded query and no-store/no-session contracts", async () => {
  const app = await createApp({
    identity,
    admissions,
    messaging,
    checkReadiness: async () => true,
  });
  try {
    const issued = await app.inject({ url: "/api/v1/auth/csrf" });
    const cookie = String(issued.headers["set-cookie"]).split(";", 1)[0] as string;
    const headers = {
      cookie,
      origin,
      "x-csrf-token": issued.json().data.token,
      "idempotency-key": newId(),
    };
    const raw = input();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/public/applications",
      headers: { ...headers, "accept-language": "ru-RU,ru;q=0.9" },
      payload: raw,
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["set-cookie"]).toBe(undefined);
    const [saved] = await unit.run((tx) =>
      unit.client(tx).select().from(applications).where(eq(applications.emailKey, raw.email)),
    );
    expect(saved?.locale).toBe("ru");
    expect(saved?.discord).toBe(null);
    expect(saved?.introduction).toBe(null);
    for (const patch of [
      { nickname: " " },
      { games: [] },
      { games: ["ets2", "ets2"] },
      { games: ["unknown"] },
      { extra: "unsupported" },
      { email: "invalid" },
      { steamProfileUrl: "https://evil.invalid" },
    ]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/public/applications",
        headers: { ...headers, "idempotency-key": newId() },
        payload: { ...raw, ...patch },
      });
      expect(r.statusCode).toBe(422);
    }
    const noOrigin = await app.inject({
      method: "POST",
      url: "/api/v1/public/applications",
      headers: { ...headers, origin: "https://other.example.invalid" },
      payload: raw,
    });
    expect(noOrigin.statusCode).toBe(403);
    const badToken = await app.inject({
      method: "POST",
      url: "/api/v1/public/invitation-redemptions",
      headers: { ...headers, "idempotency-key": newId() },
      payload: { invitationToken: `${"-".repeat(36)}.${"a".repeat(43)}`, password },
    });
    expect(badToken.statusCode).toBe(409);
    const huge = await app.inject({
      method: "POST",
      url: "/api/v1/public/applications",
      headers,
      payload: { ...raw, introduction: "a".repeat(70000) },
    });
    expect(huge.statusCode).toBe(413);
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/v1/public/applications",
      headers: { ...headers, "content-type": "text/plain" },
      payload: "fictional",
    });
    expect(unsupported.statusCode).toBe(415);
    const staffLogin = await identity.login("admissions-director@example.invalid", password);
    expect(
      (
        await app.inject({
          url: "/api/v1/admin/applications?limit=101",
          headers: {
            cookie: staffLogin.cookies.map((c) => c.split(";", 1)[0]).join("; "),
          },
        })
      ).statusCode,
    ).toBe(422);
  } finally {
    await app.close();
  }
});
test("uncertain COMMIT is never retried; safe same-key retry discovers a committed result without another account", async () => {
  const f = await approved();
  let runs = 0;
  const uncertain: UnitOfWork = {
    client: (tx) => unit.client(tx),
    close: async () => {},
    async run(command) {
      runs++;
      const result = await unit.run(command);
      if (runs === 1)
        throw new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_LOST_ACK"));
      return result;
    },
  };
  const h = harness({ unit: uncertain }),
    scope = "pre:uncertain",
    key = newId();
  await expect(h.admissions.redeem(scope, key, f.token, password)).rejects.toBeInstanceOf(
    TransactionCommitOutcomeUnknownError,
  );
  expect(runs).toBe(1);
  const replay = await admissions.redeem(scope, key, f.token, password);
  expect(await count("identity_accounts", "WHERE user_id=?", [replay.id])).toBe(1);
});
test("indexed bounded cleanup removes only expired ciphertext/results while retaining structured decision facts", async () => {
  const f = await approved(),
    security = admissionsSecurity(config),
    expired = new Date(instant - 1).toISOString();
  await unit.run(async (tx) => {
    await unit
      .client(tx)
      .insert(commandResults)
      .values(
        Array.from({ length: 105 }, () => ({
          scopeHash: security.digest("cleanup", newId()),
          key: newId(),
          fingerprint: randomBytes(32),
          result: { id: newId(), version: 1 },
          expiresAt: expired,
        })),
      );
  });
  const before = await count("admissions_command_results");
  await admissions.purge();
  expect(before - (await count("admissions_command_results"))).toBe(100);
  expect((await admissions.detail(director, f.app.id)).decision?.outcome).toBe("approve");
  const queries = [
    [
      "page",
      "EXPLAIN SELECT * FROM admissions_applications ORDER BY submitted_at DESC,id DESC LIMIT 25",
      [],
    ],
    [
      "history",
      "EXPLAIN SELECT * FROM admissions_applications WHERE email_key=? ORDER BY submitted_at DESC,id DESC LIMIT 25",
      [f.app.emailKey],
    ],
    [
      "invitation_expiry",
      "EXPLAIN UPDATE admissions_invitations SET ciphertext=NULL,secret_hash=NULL,payload_expires_at=NULL WHERE payload_expires_at<=? LIMIT 100",
      [expired],
    ],
    [
      "result_expiry",
      "EXPLAIN DELETE FROM admissions_command_results WHERE expires_at<=? LIMIT 100",
      [expired],
    ],
  ] as const;
  for (const [shape, query, values] of queries) {
    const [plans] = await control.execute<RowDataPacket[]>(query, [...values]);
    expect(plans.length > 0).toBe(true);
    for (const plan of plans)
      console.log(
        JSON.stringify({
          event: "admissions_query_plan",
          shape,
          access: String(plan.type),
          index: plan.key === null ? null : String(plan.key),
          rows: Number(plan.rows ?? 0),
        }),
      );
  }
});
test("staff command replay retains original ordinary response after reissue and consumption, without copying private facts", async () => {
  const app = await submitted(),
    decisionKey = newId();
  const first = await admissions.decide(director, app.id, decisionKey, 1, { decision: "approve" });
  const oldId = first.invitationId as string,
    reissueKey = newId();
  const replacement = await admissions.reissue(director, oldId, reissueKey, 1);
  const token = new URL((await admissions.copy(director, replacement.id, 1)).link).searchParams.get(
    "token",
  ) as string;
  await admissions.redeem("pre:replay-staff", newId(), token, password);
  expect(
    await admissions.decide(director, app.id, decisionKey, 1, { decision: "approve" }),
  ).toEqual(first);
  expect(await admissions.reissue(director, oldId, reissueKey, 1)).toEqual(replacement);
  const security = admissionsSecurity(config);
  const [result] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(commandResults)
      .where(
        eq(
          commandResults.scopeHash,
          security.digest("scope", `${director.userId}:decide:${app.id}`),
        ),
      ),
  );
  expect(result?.result.response).toEqual({ version: 2, invitationId: oldId });
  expect(Boolean(JSON.stringify(result?.result).includes(app.email))).toBe(false);
});
test("mail enabled-to-disabled mode flip still clears old private payloads atomically on reissue and consumption", async () => {
  const noMail = harness({ mail: false }).admissions;
  const f = await approved(),
    before = await admissions.inspect(director, f.invitationId);
  const replacement = await noMail.reissue(director, f.invitationId, newId(), 1);
  expect(replacement.emailDelivery).toBe("not_requested");
  const [old] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, before.deliveryId as string)),
  );
  expect(old?.ciphertext).toBe(null);
  expect(old?.state).toBe("suppressed");
  const active = await approved(),
    delivery = await admissions.inspect(director, active.invitationId);
  const result = await noMail.redeem("pre:mode-flip", newId(), active.token, password);
  expect(result.version).toBe(1);
  const [consumed] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(mailDeliveries)
      .where(eq(mailDeliveries.id, delivery.deliveryId as string)),
  );
  expect(consumed?.ciphertext).toBe(null);
  expect(consumed?.state).toBe("suppressed");
  expect((await noMail.inspect(director, active.invitationId)).state).toBe("used");
});
test("result expiry uses its selective index with substantial retained history and an empty eligible range", async () => {
  const security = admissionsSecurity(config),
    future = new Date(instant + 86400000).toISOString();
  for (let batch = 0; batch < 20; batch++)
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(commandResults)
        .values(
          Array.from({ length: 250 }, (_, i) => ({
            scopeHash: security.digest("retained", `${batch}:${i}`),
            key: newId(),
            fingerprint: security.digest("retained-input", `${batch}:${i}`),
            result: { id: newId(), version: 1 },
            expiresAt: future,
          })),
        ),
    );
  await control.query("ANALYZE TABLE admissions_command_results");
  const [eligible] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM admissions_command_results WHERE expires_at<=?",
    [time().toISOString()],
  );
  expect(Number(eligible[0]?.n)).toBe(0);
  const [plan] = await control.execute<RowDataPacket[]>(
    "EXPLAIN DELETE FROM admissions_command_results WHERE expires_at<=? LIMIT 100",
    [time().toISOString()],
  );
  expect(plan.length > 0).toBe(true);
  expect(plan[0]?.key === "admissions_result_expiry").toBe(true);
  console.log(
    JSON.stringify({
      event: "admissions_query_plan",
      shape: "result_expiry_empty",
      access: String(plan[0]?.type),
      index: String(plan[0]?.key),
      rows: Number(plan[0]?.rows ?? 0),
      retainedRows: 5000,
    }),
  );
  await admissions.purge();
  const [remaining] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM admissions_command_results WHERE expires_at>?",
    [time().toISOString()],
  );
  expect(Number(remaining[0]?.n) >= 5000).toBe(true);
});
test("concurrent expired-generation reissue and cleanup preserve consistent result-before-invitation lock order", async () => {
  const f = await approved(),
    saved = instant;
  instant = Date.parse(f.link.expiresAt);
  try {
    const [replacement] = await Promise.all([
      admissions.reissue(director, f.invitationId, newId(), 1),
      admissions.purge(),
    ]);
    expect(replacement.state).toBe("active");
    expect((await admissions.inspect(director, f.invitationId)).state).toBe("revoked");
    expect(Boolean((await admissions.copy(director, replacement.id, 1)).link)).toBe(true);
  } finally {
    instant = saved;
  }
});
