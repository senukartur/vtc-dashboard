import type { UnitOfWork } from "@vtc/db";
import type { AdmissionsConfig } from "../modules/admissions/security.js";
import { type Admissions, createAdmissions } from "../modules/admissions/service.js";
import { type AnalyticsConfig, createAnalytics } from "../modules/analytics/index.js";
import type { CatalogConfig } from "../modules/catalogs/config.js";
import { createCatalogs } from "../modules/catalogs/service.js";
import { createEventMedia, type EventMediaConfig } from "../modules/events/media.js";
import { mediaJobKinds } from "../modules/events/media-jobs.js";
import { createEvents, type EventsConfig } from "../modules/events/service.js";
import { createEventWorkspace } from "../modules/events/workspace.js";
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
import { createTripDecisionWorkspace } from "../modules/trip-decisions/workspace.js";
import { createTripActivity } from "../modules/trips/activity.js";
import { createTrips, type TripsConfig } from "../modules/trips/service.js";
import { createTripWorkspace } from "../modules/trips/workspace.js";
import { createQueue } from "../platform/jobs/queue.js";
import { admissionsEvents, createOutbox, identityAccessEvents } from "../platform/outbox/events.js";
import { createAdministration } from "./administration.js";
import { createWorkspaceSummary } from "./workspace-summary.js";

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
  eventMediaConfig?: EventMediaConfig,
  dispatchReviewStage3Enabled = false,
) {
  if (dispatchReviewStage3Enabled && !tripDecisionsConfig)
    throw new Error("DISPATCH_REVIEW_STAGE3_PREREQUISITES_REQUIRED");
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
    ...(tripsConfig
      ? {
          tripLifetimeTotals: (tx, id) => {
            if (!trips) throw new Error("TRIPS_COMPOSITION_INCOMPLETE");
            return trips.lifetimeTotalsInTransaction(tx, id);
          },
        }
      : {}),
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
  const catalogs = catalogConfig ? createCatalogs(unit, catalogConfig, { identity }) : undefined;
  let manualReports: ManualReports | undefined;
  const trips = tripsConfig
    ? createTrips(
        unit,
        { ...tripsConfig, dispatchReviewStage3Enabled },
        {
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
          ...(dispatchReviewStage3Enabled
            ? {
                adjudicationChanged: async (tx, before, after) => {
                  if (!reconciliation) throw new Error("RECONCILIATION_COMPOSITION_INCOMPLETE");
                  await reconciliation.advanceTripVersionInTransaction(tx, before, after);
                },
              }
            : {}),
          ...(tripDecisionsConfig
            ? {
                decisionProjection: (tx, id, actor) => {
                  if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                  return tripDecisions.privateProjectionInTransaction(tx, id, actor);
                },
                eventAssociations: (tx, ids) => {
                  if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                  return tripDecisions.eventAssociationsInTransaction(tx, ids);
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
          ...(eventsConfig
            ? {
                eventTitles: (tx, ids, actor) => {
                  if (!events) throw new Error("EVENTS_COMPOSITION_INCOMPLETE");
                  return events.tripTitlesInTransaction(tx, ids, actor);
                },
              }
            : {}),
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
                manualRevisions: (tx, ids) => {
                  if (!manualReports) throw new Error("MANUAL_COMPOSITION_INCOMPLETE");
                  return manualReports.revisionSummariesInTransaction(tx, ids);
                },
              }
            : {}),
        },
      )
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
      ? createReconciliation(
          unit,
          { ...reconciliationConfig, dispatchReviewStage3Enabled },
          {
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
          },
        )
      : undefined;
  const eventMedia =
    eventsConfig && eventMediaConfig
      ? createEventMedia(
          unit,
          { ...eventMediaConfig, draftsEnabled: eventsConfig.draftsEnabled === true },
          eventsConfig.cursorKey,
          identity,
        )
      : undefined;
  const events = eventsConfig
    ? createEvents(unit, eventsConfig, {
        identity,
        outbox,
        ...(eventMedia ? { media: eventMedia } : {}),
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
              attendanceTripIds: (tx, actor, eventId, game, memberIds) => {
                if (!tripDecisions) throw new Error("TRIP_DECISIONS_COMPOSITION_INCOMPLETE");
                return tripDecisions.eventAttendanceTripIdsInTransaction(
                  tx,
                  actor,
                  eventId,
                  game,
                  memberIds,
                );
              },
            }
          : {}),
      })
    : undefined;
  if (tripDecisionsConfig && trips && qualifications && manualReports && events)
    tripDecisions = createTripDecisions(
      unit,
      { ...tripDecisionsConfig, dispatchReviewStage3Enabled },
      {
        identity,
        outbox,
        trips,
        qualifications,
        manual: manualReports,
        events,
        ...(reconciliation ? { reconciliation } : {}),
      },
    );
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
  const jobsQueueFor = (pausedKinds: readonly string[] = []) =>
    createQueue(
      unit,
      [
        ...(messaging ? [messaging.handler] : []),
        ...(manualReports ? [manualReports.handler, manualReports.generationHandler] : []),
        ...(reconciliation ? [reconciliation.handler] : []),
        ...(tripDecisions ? [tripDecisions.handler] : []),
        ...(notifications ? [notifications.handler, notifications.reminderHandler] : []),
        ...(eventMedia?.handlers ?? []),
      ],
      notifications ? [notifications.subscription] : [],
      undefined,
      [
        ...pausedKinds,
        ...(!messaging ? ["mail.deliver"] : []),
        ...(!reconciliation ? ["reconciliation.search"] : []),
        ...(!tripDecisions ? ["trips.reevaluate"] : []),
        ...(!notifications ? ["notifications.deliver", "notifications.remind"] : []),
        ...(!eventMedia ? mediaJobKinds : []),
        ...(!manualReports?.config.storage
          ? ["manual.evidence-delete", "manual.generation-delete"]
          : []),
      ],
    );
  const externalIdentities = externalEnabled ? createExternalIdentities(unit, identity) : undefined;
  const analytics =
    analyticsConfig && trips ? createAnalytics(unit, identity, analyticsConfig) : undefined;
  const tripWorkspace = trips ? createTripWorkspace(unit) : undefined;
  const tripActivity = trips ? createTripActivity(unit) : undefined;
  const acceptanceWorkspace =
    tripDecisions && tripWorkspace && manualReports
      ? createTripDecisionWorkspace(unit, {
          rejectedGroupMembers: tripWorkspace.rejectedGroupMembers,
          resubmittableRevisions: manualReports.workspaceCurrentAuthorRevisionsRelation,
        })
      : undefined;
  const workspaceSummary = createWorkspaceSummary(identity, {
    ...(tripWorkspace ? { trips: tripWorkspace } : {}),
    ...(dispatchReviewStage3Enabled && tripDecisions
      ? { dispatch: tripDecisions.reviewQueue }
      : {}),
    ...(acceptanceWorkspace ? { acceptance: acceptanceWorkspace } : {}),
    ...(manualReports ? { manualReports } : {}),
    ...(events ? { events: createEventWorkspace(unit) } : {}),
    ...(admissions ? { admissions } : {}),
  });
  return {
    identity,
    workspaceSummary,
    ...(notifications ? { notifications } : {}),
    administration: createAdministration(
      unit,
      identity,
      {
        telemetry: !!telemetryConfig,
        manual: !!manualConfig,
        qualifications: !!qualificationsConfig,
        externalIdentities: externalEnabled,
        admissions: !!admissionsConfig,
        mail: !!mail,
      },
      !!tripsConfig,
      {
        ...(tripActivity ? { tripActivity } : {}),
        ...(admissions ? { admissions } : {}),
      },
    ),
    ...(analytics ? { analytics } : {}),
    ...(manualReports ? { manualReports } : {}),
    ...(events ? { events } : {}),
    ...(eventMedia ? { eventMedia } : {}),
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
    jobsQueue: jobsQueueFor(),
    jobsQueueFor,
    ...(catalogs ? { catalogs } : {}),
    ...(messaging ? { messaging } : {}),
    ...(admissions ? { admissions } : {}),
  };
}
