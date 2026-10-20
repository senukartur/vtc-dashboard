import type { UnitOfWork } from "@vtc/db";
import type { AdmissionsConfig } from "../modules/admissions/security.js";
import { type Admissions, createAdmissions } from "../modules/admissions/service.js";
import type { CatalogConfig } from "../modules/catalogs/artifact.js";
import { createCatalogs } from "../modules/catalogs/service.js";
import {
  createExternalIdentities,
  steamProjection,
} from "../modules/external-identities/service.js";
import type { IdentityConfig } from "../modules/identity/engine.js";
import { createIdentity, type Identity } from "../modules/identity/service.js";
import { localProvider, resendProvider } from "../modules/messaging/provider.js";
import {
  createMessaging,
  invalidateAdmissionsMail,
  type MessagingConfig,
} from "../modules/messaging/service.js";
import { createQualificationInitialization } from "../modules/qualifications/initialization.js";
import { createTrips, type TripsConfig } from "../modules/trips/service.js";
import { createQueue } from "../platform/jobs/queue.js";
import {
  admissionsEvents,
  catalogEvents,
  identityAccessEvents,
} from "../platform/outbox/events.js";

export function composeIdentity(
  unit: UnitOfWork,
  identityConfig: IdentityConfig,
  mail?: MessagingConfig & { apiKey?: string },
  admissionsConfig?: AdmissionsConfig,
  externalEnabled = false,
  catalogConfig?: CatalogConfig,
  tripsConfig?: TripsConfig,
) {
  let identity: Identity;
  let admissions: Admissions | undefined;
  const messaging = mail
    ? createMessaging(
        unit,
        mail,
        mail.mode === "local" ? localProvider() : resendProvider(mail.apiKey ?? ""),
        {
          identityValid: (tx, input) => identity.deliveryValid(tx, input),
          admissionsValid: (tx, input) =>
            admissions?.deliveryValid(tx, input) ?? Promise.resolve(false),
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
    ...(externalEnabled ? { steamProjection: steamProjection(unit) } : {}),
    ...(messaging ? { delivery: messaging.delivery } : {}),
  });
  if (admissionsConfig)
    admissions = createAdmissions(unit, admissionsConfig, {
      identity,
      qualifications: createQualificationInitialization(unit),
      events: admissionsEvents(unit),
      invalidateMail: (tx, id) => invalidateAdmissionsMail(unit, tx, id),
      ...(messaging
        ? {
            mail: {
              enqueue: messaging.enqueue,
              status: messaging.admissionsStatus,
            },
          }
        : {}),
    });
  const catalogs = catalogConfig
    ? createCatalogs(unit, catalogConfig, { identity, published: catalogEvents(unit).append })
    : undefined;
  const jobsQueue = createQueue(
    unit,
    [...(messaging ? [messaging.handler] : []), ...(catalogs ? [catalogs.handler] : [])],
    [],
    undefined,
    [...(!messaging ? ["mail.deliver"] : []), ...(!catalogs ? ["catalog.import"] : [])],
  );
  return {
    identity,
    ...(tripsConfig
      ? { trips: createTrips(unit, tripsConfig, { identity, ...(catalogs ? { catalogs } : {}) }) }
      : {}),
    ...(externalEnabled ? { externalIdentities: createExternalIdentities(unit, identity) } : {}),
    jobsQueue,
    ...(catalogs ? { catalogs } : {}),
    ...(messaging ? { messaging } : {}),
    ...(admissions ? { admissions } : {}),
  };
}
