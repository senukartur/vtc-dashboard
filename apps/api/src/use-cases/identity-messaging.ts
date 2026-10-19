import type { UnitOfWork } from "@vtc/db";
import type { IdentityConfig } from "../modules/identity/engine.js";
import { createIdentity, type Identity } from "../modules/identity/service.js";
import { localProvider, resendProvider } from "../modules/messaging/provider.js";
import { createMessaging, type MessagingConfig } from "../modules/messaging/service.js";
import { identityAccessEvents } from "../platform/outbox/events.js";

export function composeIdentity(
  unit: UnitOfWork,
  identityConfig: IdentityConfig,
  mail?: MessagingConfig & { apiKey?: string },
) {
  let identity: Identity;
  const messaging = mail
    ? createMessaging(
        unit,
        mail,
        mail.mode === "local" ? localProvider() : resendProvider(mail.apiKey ?? ""),
        {
          identityValid: (tx, input) => identity.deliveryValid(tx, input),
          authorize: async (tx, actor, scope) => {
            await identity.authorizeInTransaction(
              tx,
              actor,
              scope === "admissions" ? "applications.manage" : "company.read",
            );
          },
        },
      )
    : undefined;
  identity = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    ...(messaging ? { delivery: messaging.delivery } : {}),
  });
  return { identity, ...(messaging ? { messaging } : {}) };
}
