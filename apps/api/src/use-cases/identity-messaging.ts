import type { UnitOfWork } from "@vtc/db";
import type { AdmissionsConfig } from "../modules/admissions/security.js";
import { type Admissions, createAdmissions } from "../modules/admissions/service.js";
import { type AnalyticsConfig, createAnalytics } from "../modules/analytics/index.js";
import type { CatalogConfig } from "../modules/catalogs/artifact.js";
import { createCatalogs } from "../modules/catalogs/service.js";
import { createEvents, type EventsConfig } from "../modules/events/service.js";
import {
  createExternalIdentities,
  steamProjection,
} from "../modules/external-identities/service.js";
import type { IdentityConfig } from "../modules/identity/engine.js";
import { createIdentity, type Identity } from "../modules/identity/service.js";
import {
  createManualReports,
  type ManualConfig,
  type ManualReports,
} from "../modules/manual-reports/service.js";
import { localProvider, resendProvider } from "../modules/messaging/provider.js";
import {
  createMessaging,
  invalidateAdmissionsMail,
  type MessagingConfig,
} from "../modules/messaging/service.js";
import {
  createNotifications,
  invalidateEventNotifications,
  type NotificationsConfig,
} from "../modules/notifications/service.js";
import { createQualificationInitialization } from "../modules/qualifications/initialization.js";
import {
  createQualifications,
  type Qualifications,
  type QualificationsConfig,
} from "../modules/qualifications/service.js";
import type { ReconciliationConfig } from "../modules/reconciliation/matcher.js";
import { createReconciliation, type Reconciliation } from "../modules/reconciliation/service.js";
import {
  createTelemetry,
  invalidateTelemetryCredentials,
  type TelemetryConfig,
} from "../modules/telemetry/service.js";
import {
  createTripDecisions,
  type TripDecisions,
  type TripDecisionsConfig,
} from "../modules/trip-decisions/service.js";
import { createTrips, type TripsConfig } from "../modules/trips/service.js";
import { createQueue } from "../platform/jobs/queue.js";
import {
  admissionsEvents,
  catalogEvents,
  createOutbox,
  identityAccessEvents,
} from "../platform/outbox/events.js";
import { createAdministration } from "./administration.js";

export function composeIdentity(
  unit: UnitOfWork,
  identityConfig: IdentityConfig,
  mail?: MessagingConfig & { apiKey?: string },
  admissionsConfig?: AdmissionsConfig,
  externalEnabled = false,
  catalogConfig?: CatalogConfig,
  tripsConfig?: TripsConfig,
  telemetryConfig?: TelemetryConfig,
  manualConfig?: ManualConfig,
  qualificationsConfig?: QualificationsConfig,
  eventsConfig?: EventsConfig,
  reconciliationConfig?: ReconciliationConfig,
  tripDecisionsConfig?: TripDecisionsConfig,
  analyticsConfig?: AnalyticsConfig,
  notificationsConfig?: NotificationsConfig,
) {
  const outbox = createOutbox(unit, { notifications: !!notificationsConfig });
  let identity: Identity;
  let qualifications: Qualifications | undefined, reconciliation: Reconciliation | undefined;
  if (reconciliationConfig && (!tripsConfig || !qualificationsConfig))
    throw new Error("RECONCILIATION_PREREQUISITES_REQUIRED");
  if (telemetryConfig && (!externalEnabled || !tripsConfig))
    throw new Error("TELEMETRY_PREREQUISITES_REQUIRED");
  if (qualificationsConfig && !tripsConfig)
    throw new Error("QUALIFICATIONS_PREREQUISITES_REQUIRED");
  let tripDecisions: TripDecisions | undefined;
  if (
    tripDecisionsConfig &&
    (!tripsConfig ||
      !qualificationsConfig ||
      !manualConfig ||
      !eventsConfig ||
      !catalogConfig ||
      !reconciliationConfig)
  )
    throw new Error("TRIP_DECISIONS_PREREQUISITES_REQUIRED");
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
    accessEvents: identityAccessEvents(unit, outbox),
    qualificationsLifecycle: createQualificationInitialization(unit, outbox),
    ...(telemetryConfig
      ? { invalidateTelemetryCredentials: (tx, id) => invalidateTelemetryCredentials(unit, tx, id) }
      : {}),
    ...(externalEnabled ? { steamProjection: steamProjection(unit) } : {}),
    ...(messaging ? { delivery: messaging.delivery } : {}),
  });
  if (admissionsConfig)
    admissions = createAdmissions(unit, admissionsConfig, {
      identity,
      qualifications: createQualificationInitialization(unit, outbox),
      events: admissionsEvents(unit, outbox),
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
    ? createCatalogs(unit, catalogConfig, {
        identity,
        published: catalogEvents(unit, outbox).append,
      })
    : undefined;
  let manualReports: ManualReports | undefined;
  const trips = tripsConfig
    ? createTrips(unit, tripsConfig, {
        identity,
        events: outbox,
        ...(reconciliationConfig || tripDecisionsConfig
          ? {
              prepare: async (tx, ownerId, game) => {
                if (!qualifications) throw new Error("RECONCILIATION_COMPOSITION_INCOMPLETE");
                await qualifications.prepareInTransaction(tx, [{ ownerId, game }]);
              },
              sourceStored: async (tx, tripId, sourceRecordId) => {
                if (reconciliationConfig && !reconciliation)
                  throw new Error("RECONCILIATION_COMPOSITION_INCOMPLETE");
                await reconciliation?.refreshInTransaction(tx, tripId, sourceRecordId);
                if (tripDecisionsConfig && !tripDecisions)
                  throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                await tripDecisions?.assessInTransaction(tx, tripId);
              },
            }
          : {}),
        ...(tripDecisionsConfig
          ? {
              decisionProjection: (tx, id, actor) => {
                if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                return tripDecisions.privateProjectionInTransaction(tx, id, actor);
              },
              correctionRequested: async (tx, id, requestId, actor, reason) => {
                if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                await tripDecisions.correctionRequestedInTransaction(
                  tx,
                  id,
                  requestId,
                  actor,
                  reason,
                );
              },
            }
          : {}),
        ...(catalogs ? { catalogs } : {}),
        ...(manualConfig
          ? {
              manualEvidence: (tx, owner, payload, tripId) => {
                if (!manualReports) throw new Error("MANUAL_COMPOSITION_INCOMPLETE");
                return manualReports.validateSourceInTransaction(tx, owner, payload, tripId);
              },
              manualProjection: (tx, ids) => {
                if (!manualReports) throw new Error("MANUAL_COMPOSITION_INCOMPLETE");
                return manualReports.projectionInTransaction(tx, ids);
              },
            }
          : {}),
      })
    : undefined;
  qualifications =
    qualificationsConfig && trips
      ? createQualifications(unit, qualificationsConfig, {
          identity,
          events: outbox,
          trips,
          ...(catalogs ? { catalogs } : {}),
        })
      : undefined;
  if (manualConfig) {
    if (!trips || !catalogs) throw new Error("MANUAL_PREREQUISITES_REQUIRED");
    manualReports = createManualReports(unit, manualConfig, { identity, catalogs, trips, outbox });
  }
  reconciliation =
    reconciliationConfig && trips && qualifications
      ? createReconciliation(unit, reconciliationConfig, {
          identity,
          outbox,
          trips,
          qualifications,
          ...(manualReports ? { manual: manualReports } : {}),
          ...(tripDecisionsConfig
            ? {
                workflowChanged: async (tx, id) => {
                  if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                  await tripDecisions.assessInTransaction(tx, id);
                },
              }
            : {}),
        })
      : undefined;
  const events = eventsConfig
    ? createEvents(unit, eventsConfig, {
        identity,
        outbox,
        ...(notificationsConfig
          ? {
              notificationChanged: (
                tx: import("@vtc/db").TxContext,
                eventId: string,
                memberId: string | null,
              ) => invalidateEventNotifications(unit, tx, eventId, memberId),
            }
          : {}),
        ...(catalogs ? { catalogs } : {}),
        ...(tripDecisionsConfig
          ? {
              tripChanged: async (tx, eventId, generation) => {
                if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                await tripDecisions.eventChangedInTransaction(tx, eventId, generation);
              },
            }
          : {}),
      })
    : undefined;
  if (tripDecisionsConfig && trips && qualifications && manualReports && events)
    tripDecisions = createTripDecisions(unit, tripDecisionsConfig, {
      identity,
      outbox,
      trips,
      qualifications,
      manual: manualReports,
      events,
    });
  if (notificationsConfig && (!trips || !qualifications || !events || !tripDecisions))
    throw new Error("NOTIFICATIONS_PREREQUISITES_REQUIRED");
  const notifications =
    notificationsConfig && trips && qualifications && events && tripDecisions
      ? createNotifications(unit, notificationsConfig, {
          identity,
          trips,
          qualifications,
          events,
          decisions: tripDecisions,
          manual: manualReports as ManualReports,
        })
      : undefined;
  const jobsQueue = createQueue(
    unit,
    [
      ...(messaging ? [messaging.handler] : []),
      ...(catalogs ? [catalogs.handler] : []),
      ...(manualReports ? [manualReports.handler, manualReports.generationHandler] : []),
      ...(reconciliation ? [reconciliation.handler] : []),
      ...(tripDecisions ? [tripDecisions.handler] : []),
      ...(notifications ? [notifications.handler, notifications.reminderHandler] : []),
    ],
    notifications ? [notifications.subscription] : [],
    undefined,
    [
      ...(!messaging ? ["mail.deliver"] : []),
      ...(!catalogs ? ["catalog.import"] : []),
      ...(!reconciliation ? ["reconciliation.search"] : []),
      ...(!tripDecisions ? ["trips.reevaluate"] : []),
      ...(!notifications ? ["notifications.deliver", "notifications.remind"] : []),
      ...(!manualReports?.config.storage
        ? ["manual.evidence-delete", "manual.generation-delete"]
        : []),
    ],
  );
  const externalIdentities = externalEnabled ? createExternalIdentities(unit, identity) : undefined;
  const analytics =
    analyticsConfig && trips ? createAnalytics(unit, identity, analyticsConfig) : undefined;
  return {
    identity,
    ...(notifications ? { notifications } : {}),
    administration: createAdministration(unit, identity, {
      telemetry: !!telemetryConfig,
      manual: !!manualConfig,
      qualifications: !!qualificationsConfig,
      externalIdentities: externalEnabled,
      admissions: !!admissionsConfig,
      mail: !!mail,
    }),
    ...(analytics ? { analytics } : {}),
    ...(manualReports ? { manualReports } : {}),
    ...(events ? { events } : {}),
    ...(tripDecisions ? { tripDecisions } : {}),
    ...(qualifications ? { qualifications } : {}),
    ...(reconciliation ? { reconciliation } : {}),
    ...(telemetryConfig && trips && externalIdentities
      ? {
          telemetry: createTelemetry(unit, telemetryConfig, {
            identity,
            external: externalIdentities,
            trips,
          }),
        }
      : {}),
    ...(trips ? { trips } : {}),
    ...(externalIdentities ? { externalIdentities } : {}),
    jobsQueue,
    ...(catalogs ? { catalogs } : {}),
    ...(messaging ? { messaging } : {}),
    ...(admissions ? { admissions } : {}),
  };
}
