import type { components } from "@vtc/contracts";
import type { TxContext } from "@vtc/db";
import type { Actor, Identity } from "../modules/identity/service.js";

type Summary = components["schemas"]["WorkspaceSummary"];
type Stage3Summary = components["schemas"]["WorkspaceStage3Summary"];
type Section<K extends keyof Summary> = NonNullable<Summary[K]>;

interface WorkspaceSources {
  // Acceptance supplies this facade only when both Trips and Manual Reports are readable.
  acceptance?: {
    workspaceReturnedTripsInTransaction(
      tx: TxContext,
      viewerId: string,
    ): Promise<Section<"tripsNeedingFixes">>;
  };
  manualReports?: {
    workspaceEditingDraftsInTransaction(
      tx: TxContext,
      viewerId: string,
    ): Promise<Section<"unfinishedManualDrafts">>;
  };
  events?: {
    workspaceUnansweredEventsInTransaction(
      tx: TxContext,
      viewerId: string,
      computedAt: string,
    ): Promise<Section<"unansweredUpcomingEvents">>;
  };
  trips?: {
    workspaceReviewQueueInTransaction(
      tx: TxContext,
      viewerId: string,
    ): Promise<{ count: number; oldestCreatedAt: string | null }>;
  };
  dispatch?: {
    summaryInTransaction(
      tx: TxContext,
      viewerId: string,
      computedAt: string,
    ): Promise<NonNullable<Stage3Summary["reviewQueue"]>>;
  };
  qualifications?: {
    workspacePromotionsReadyInTransaction(
      tx: TxContext,
      computedAt: string,
    ): Promise<NonNullable<Stage3Summary["promotionsReady"]>>;
  };
  admissions?: {
    submittedCountInTransaction(tx: TxContext, actor: Actor): Promise<number>;
  };
}

export function createWorkspaceSummary(
  identity: Pick<Identity, "transaction" | "authorizeInTransaction">,
  sources: WorkspaceSources,
  now: () => Date = () => new Date(),
) {
  async function read(actor: Actor, stage3: true): Promise<Stage3Summary>;
  async function read(actor: Actor, stage3?: false): Promise<Summary>;
  async function read(actor: Actor, stage3 = false): Promise<Summary | Stage3Summary> {
    return identity.transaction(async (tx) => {
      const current = await identity.authorizeInTransaction(tx, actor, "company.read");
      const computedAt = now().toISOString();
      const summary: Summary = { computedAt };
      const allowed = (capability: string) => current.capabilities.includes(capability);

      if (sources.acceptance && allowed("trips.read_own_private")) {
        const { count, items } = await sources.acceptance.workspaceReturnedTripsInTransaction(
          tx,
          current.userId,
        );
        summary.tripsNeedingFixes = {
          count,
          items: items.map(({ tripId, latestReturnReason }) => ({ tripId, latestReturnReason })),
        };
      }
      if (sources.manualReports && allowed("trips.submit_own")) {
        const { count, items } = await sources.manualReports.workspaceEditingDraftsInTransaction(
          tx,
          current.userId,
        );
        summary.unfinishedManualDrafts = {
          count,
          items: items.map(({ draftId, updatedAt }) => ({ draftId, updatedAt })),
        };
      }
      if (sources.events && allowed("events.respond")) {
        const { count, items } = await sources.events.workspaceUnansweredEventsInTransaction(
          tx,
          current.userId,
          computedAt,
        );
        summary.unansweredUpcomingEvents = {
          count,
          items: items.map(({ eventId, title, startsAt }) => ({ eventId, title, startsAt })),
        };
      }
      const review =
        stage3 && sources.dispatch && allowed("trips.review")
          ? await sources.dispatch.summaryInTransaction(tx, current.userId, computedAt)
          : undefined;
      if (sources.trips && allowed("trips.review") && !review) {
        const { count, oldestCreatedAt } = await sources.trips.workspaceReviewQueueInTransaction(
          tx,
          current.userId,
        );
        summary.reviewQueue = {
          count,
          oldestAgeSeconds:
            oldestCreatedAt === null
              ? null
              : Math.max(
                  0,
                  Math.floor((Date.parse(computedAt) - Date.parse(oldestCreatedAt)) / 1000),
                ),
        };
      }
      if (sources.admissions && allowed("applications.manage")) {
        summary.newApplicationsCount = await sources.admissions.submittedCountInTransaction(
          tx,
          current,
        );
      }
      if (!stage3) return summary;
      const { reviewQueue: legacyReviewQueue, ...sections } = summary;
      const promotionsReady =
        sources.qualifications && allowed("qualifications.manage")
          ? await sources.qualifications.workspacePromotionsReadyInTransaction(tx, computedAt)
          : undefined;
      return {
        ...sections,
        ...(review ? { reviewQueue: review } : legacyReviewQueue ? { legacyReviewQueue } : {}),
        ...(promotionsReady ? { promotionsReady } : {}),
      };
    });
  }
  return { read, readStage3: (actor: Actor) => read(actor, true) };
}
