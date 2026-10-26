import { randomBytes, randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { createUnitOfWork } from "@vtc/db";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { createQualificationInitialization } from "../../../apps/api/src/modules/qualifications/initialization.ts";
import { identityAccessEvents } from "../../../apps/api/src/platform/outbox/events.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { accountSecret, browserAdmissionsKey, origin } from "./account.ts";
import { composeIdentity } from "../../../apps/api/src/use-cases/identity-messaging.ts";
import { createMessaging } from "../../../apps/api/src/modules/messaging/service.ts";
import { localProvider } from "../../../apps/api/src/modules/messaging/provider.ts";
import {
  ExternalRejectedError,
  ExternalAmbiguityError,
} from "../../../apps/api/src/platform/jobs/queue.ts";
import { testConnection } from "../../persistence/support.ts";
export async function administrationMember(
  roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["driver"],
) {
  const unit = createUnitOfWork(guardedSettings()),
    identity = createIdentity(
      unit,
      { secret: accountSecret("identity"), origin, production: false },
      {
        accessEvents: identityAccessEvents(unit),
        qualificationsLifecycle: createQualificationInitialization(unit),
      },
    );
  const userId = randomUUID(),
    email = `${userId}@example.invalid`,
    password = randomBytes(32).toString("base64url"),
    name = `Fictional Admin ${userId.slice(0, 8)}`;
  try {
    const credential = await identity.prepareCredential(password);
    await unit.run(async (tx) => {
      await identity.insertWithCredential(tx, { userId, email, name, roles, ...credential });
      await createQualificationInitialization(unit).initialize(tx, {
        userId,
        games: ["ets2", "ats"],
        assignedAt: new Date(Date.now() - 10000).toISOString(),
      });
    });
    return { userId, email, password, name };
  } finally {
    await unit.close();
  }
}

async function mailFixture(staff: APIRequestContext) {
  const unit = createUnitOfWork(guardedSettings()),
    composed = composeIdentity(
      unit,
      { secret: accountSecret("identity"), origin, production: false },
      undefined,
      { key: browserAdmissionsKey(), origin },
    );
  try {
    const state = await staff.storageState(),
      actor = await composed.identity.authenticate(
        new Headers({ cookie: state.cookies.map((row) => `${row.name}=${row.value}`).join("; ") }),
      );
    if (!composed.admissions) throw new Error("SYNTHETIC_ADMISSIONS_REQUIRED");
    return { unit, composed, actor, admissions: composed.admissions };
  } catch (error) {
    await unit.close();
    throw error;
  }
}
export async function approveWithMailDisabled(staff: APIRequestContext, id: string) {
  const fixture = await mailFixture(staff);
  try {
    const detail = await fixture.admissions.detail(fixture.actor, id);
    const approved = await fixture.admissions.decide(
      fixture.actor,
      id,
      randomUUID(),
      detail.version,
      { decision: "approve" },
    );
    if (!approved.invitationId) throw new Error("SYNTHETIC_INVITATION_REQUIRED");
    return approved.invitationId;
  } finally {
    await fixture.unit.close();
  }
}
export async function controlledInvitationMailFailure(
  staff: APIRequestContext,
  deliveryId: string,
  ambiguous = false,
) {
  const fixture = await mailFixture(staff),
    connection = await testConnection();
  try {
    const messaging = createMessaging(
      fixture.unit,
      {
        mode: "local",
        key: accountSecret("mail"),
        sender: "sender@example.invalid",
        origin,
        production: false,
      },
      {
        ...localProvider(),
        send: async () =>
          ambiguous
            ? { state: "ambiguous", category: "acceptance_unknown" }
            : { state: "rejected", category: "authentication", retryAfterMs: null },
      },
      {
        identityValid: (tx, input) => fixture.composed.identity.deliveryValid(tx, input),
        admissionsValid: (tx, input) => fixture.admissions.deliveryValid(tx, input),
        authorize: async (tx, actor, scope) => {
          await fixture.composed.identity.authorizeInTransaction(
            tx,
            actor,
            scope === "admissions" ? "applications.manage" : "company.read",
          );
        },
      },
    );
    if (!messaging.handler.external) throw new Error("SYNTHETIC_MAIL_HANDLER_REQUIRED");
    let rejected = false;
    try {
      await messaging.handler.external(
        { deliveryId },
        `messaging.mail:${deliveryId}`,
        new AbortController().signal,
        { remainingMs: () => 30000 },
      );
    } catch (error) {
      if (
        !(ambiguous
          ? error instanceof ExternalAmbiguityError
          : error instanceof ExternalRejectedError)
      )
        throw error;
      rejected = true;
    }
    if (
      !rejected ||
      (await messaging.inspect(fixture.actor, deliveryId)).state !==
        (ambiguous ? "ambiguous" : "failed")
    )
      throw new Error("SYNTHETIC_CONTROLLED_OUTCOME_REQUIRED");
    // The controlled handler executed real encrypted preparation and a known rejected
    // local transport. Acknowledge only this fixture's job as the queue normally does.
    const [result] = await connection.execute(
      "UPDATE durable_jobs SET state='failed',failure=?,attempts=attempts+1,lease_token=NULL,lease_until=NULL WHERE consumer=? AND kind=? AND effect_key=? AND state='ready' AND attempts<5",
      [
        ambiguous ? "external_ambiguity" : "handler_failed",
        Buffer.from("messaging.mail"),
        Buffer.from("mail.deliver"),
        Buffer.from(deliveryId),
      ],
    );
    if (!("affectedRows" in result) || result.affectedRows !== 1)
      throw new Error("SYNTHETIC_MAIL_ACK_REQUIRED");
  } finally {
    await connection.end();
    await fixture.unit.close();
  }
}
export async function invitationMailJob(deliveryId: string) {
  const connection = await testConnection();
  try {
    const [rows] = await connection.execute(
      "SELECT CAST(id AS CHAR) id,state,attempts FROM durable_jobs WHERE consumer=? AND effect_key=?",
      [Buffer.from("messaging.mail"), Buffer.from(deliveryId)],
    );
    const row = (rows as { id: string; state: string; attempts: number }[])[0];
    if (!row) throw new Error("SYNTHETIC_MAIL_JOB_REQUIRED");
    return row;
  } finally {
    await connection.end();
  }
}
