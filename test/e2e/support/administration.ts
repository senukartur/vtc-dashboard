import { randomBytes, randomUUID } from "node:crypto";
import { createUnitOfWork } from "@vtc/db";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { createQualificationInitialization } from "../../../apps/api/src/modules/qualifications/initialization.ts";
import { identityAccessEvents } from "../../../apps/api/src/platform/outbox/events.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { accountSecret, origin } from "./account.ts";
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
