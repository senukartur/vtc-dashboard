import { createHmac } from "node:crypto";
import type { companionComponents } from "@vtc/contracts";
import { utcDateTime, type TxContext } from "@vtc/db";
import type { Catalogs } from "../modules/catalogs/service.js";
import type { Events } from "../modules/events/service.js";
import type { QualificationSnapshot } from "../modules/qualifications/check.js";
import { companionLimits, companionRules } from "../modules/qualifications/companion.js";
import {
  checkPreview,
  previewDistanceEnvelope,
  previewFacts,
} from "../modules/qualifications/preview.js";
import type { Qualifications } from "../modules/qualifications/service.js";
import { canonicalJson, decimal } from "../modules/sources/contracts/canonical.js";
import { TelemetryError } from "../modules/telemetry/parser.js";
import type { TelemetryService } from "../modules/telemetry/service.js";
import type { createCompanionAssessments } from "../modules/trip-decisions/companion.js";
import type { Trips } from "../modules/trips/service.js";

type S = companionComponents["schemas"];
export function createTelemetryCompanion(
  ports: {
    telemetry: TelemetryService;
    trips: Trips;
    qualifications?: Qualifications;
    catalogs?: Catalogs;
    events?: Events;
    assessments?: ReturnType<typeof createCompanionAssessments>;
  },
  now = () => new Date(),
) {
  const sign = (value: unknown) =>
    createHmac("sha256", Buffer.from(ports.telemetry.config.cursorKey, "hex"))
      .update("companion/version/v1\0")
      .update(canonicalJson(value))
      .digest("base64url");
  const enabled = () => ({
    qualificationEnabled: !!ports.qualifications,
    previewEnabled: !!ports.qualifications && !!ports.catalogs,
    resultsEnabled: !!ports.assessments,
  });
  const validPairs = (input: S["PreviewInput"]) => {
    for (const code of [input.cargo.code, ...input.trailers.items.map((item) => item.code)])
      if (code !== null && Buffer.byteLength(code) > 128)
        throw new TelemetryError(400, "INVALID_PAYLOAD");
    for (const [availability, value] of [
      [input.cargo.availability, input.cargo.code],
      [input.cargoMassKg.availability, input.cargoMassKg.value],
      [input.actualDistance.availability, input.actualDistance.metres],
    ])
      if ((availability === "known") !== (value !== null))
        throw new TelemetryError(400, "INVALID_PAYLOAD");
    if (input.start) {
      try {
        utcDateTime(input.start.utc);
      } catch {
        throw new TelemetryError(400, "INVALID_PAYLOAD");
      }
      if (new Date(input.start.utc).getTime() > now().getTime())
        throw new TelemetryError(400, "INVALID_PAYLOAD");
    }
  };
  async function assessment(
    tx: TxContext,
    row: NonNullable<
      Awaited<ReturnType<NonNullable<typeof ports.assessments>["read"]>>
    >["decision"],
  ): Promise<S["Assessment"] | null> {
    if (!row) return null;
    const snapshot = row.qualificationSnapshot as unknown as QualificationSnapshot | null;
    const material = await ports.trips.companion.material(tx, row.factId);
    const allowed = new Set<string>([
      "qualification_cargo_mass",
      "qualification_distance",
      "qualification_trailer",
      "qualification_adr",
      "qualification_hard_mode",
      "qualification_unknown",
      "qualification_level_unknown",
      "qualification_attribution_time_unknown",
      "event_attendance_exemption",
    ]);
    return {
      availability: snapshot ? "retained" : "historical_unavailable",
      decisionId: row.id,
      decisionSequence: row.sequence,
      decidedAt: row.decidedAt,
      factId: row.factId,
      sourceMessageId: material?.id ?? null,
      sourceRevision: material?.revision ?? null,
      sourceEventId: material?.eventId ?? null,
      assessedSource: material?.source ?? null,
      trailerDisplay:
        snapshot?.limits && material?.game && ports.catalogs
          ? await ports.catalogs.companionTrailerDisplayInTransaction(
              tx,
              material.game,
              [
                ...snapshot.limits.trailers.typeIds,
                ...(snapshot.exemptionRules ?? snapshot.rules).flatMap((rule) =>
                  rule.rule === "trailer_types" ? rule.observedIds : [],
                ),
              ],
              now().toISOString(),
            )
          : [],
      trailerComparison:
        snapshot?.trailerGroups && snapshot.limits
          ? {
              basis: snapshot.limits.trailers.basis ?? "variant",
              entries: Object.entries(snapshot.trailerGroups)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([id, comparisonIdentity]) => ({ id, comparisonIdentity })),
            }
          : null,
      materialIdentity: row.factId,
      assignmentId: row.assignmentId,
      level:
        snapshot?.levelId && snapshot.levelName && snapshot.editVersion
          ? { id: snapshot.levelId, name: snapshot.levelName, editVersion: snapshot.editVersion }
          : null,
      limits: snapshot?.limits ? companionLimits(snapshot.limits) : null,
      outcome: snapshot?.outcome ?? null,
      rules: companionRules(snapshot?.exemptionRules ?? snapshot?.rules ?? []).map((rule) => ({
        ...rule,
        reasons: [
          snapshot?.eventExempt
            ? "event_attendance_exemption"
            : rule.result === "fail"
              ? "limit_mismatch"
              : rule.result === "unknown"
                ? "fact_unavailable"
                : "within_limits",
        ] as S["Rule"]["reasons"],
      })),
      eventExempt: snapshot?.eventExempt ?? false,
      reasons: (snapshot?.eventExempt
        ? ["event_attendance_exemption"]
        : snapshot?.reasonCode && allowed.has(snapshot.reasonCode)
          ? [snapshot.reasonCode]
          : []) as S["Assessment"]["reasons"],
    };
  }
  return {
    async capabilities(
      bearer: string | undefined,
      ip: string,
      ticket?: object,
    ): Promise<S["Capabilities"]> {
      return ports.telemetry.companion(
        bearer,
        ip,
        async (_tx, _token, scope) => ({
          contract: "1.0",
          securityScope: scope,
          capability: "companion.own.v1",
          games: ["ets2", "ats"],
          ...enabled(),
          maxBatch: 25,
          maxBodyBytes: 16384,
          previewTtlSeconds: 5,
          pollMinimumSeconds: 5,
        }),
        ticket,
      );
    },
    async qualification(
      bearer: string | undefined,
      ip: string,
      game: S["Game"],
      ticket?: object,
    ): Promise<S["Qualification"]> {
      return ports.telemetry.companion(
        bearer,
        ip,
        async (tx, token, scope) => {
          const current = ports.qualifications
            ? await ports.qualifications.companion.current(tx, token.ownerId, game)
            : { state: "unavailable" as const, assignment: null, progress: null };
          const asOf = now();
          return {
            contract: "1.0",
            securityScope: scope,
            ownerId: token.ownerId,
            game,
            ...current,
            asOf: asOf.toISOString(),
            progressRevision: await ports.trips.companion.revision.read(tx, token.ownerId),
            refreshAfterSeconds: 5,
            offlineUsableUntil: new Date(asOf.getTime() + 300000).toISOString(),
          };
        },
        ticket,
      );
    },
    async preview(
      bearer: string | undefined,
      ip: string,
      input: S["PreviewInput"],
      ticket?: object,
    ): Promise<S["Preview"]> {
      validPairs(input);
      return ports.telemetry.companion(
        bearer,
        ip,
        async (tx, token, scope) => {
          const historical = input.start?.basis === "actual" ? input.start.utc : undefined;
          const configured =
            (await ports.qualifications?.companion.assignment(
              tx,
              token.ownerId,
              input.game,
              historical,
            )) ?? null;
          const assignment = configured?.assignment ?? null;
          const facts = await previewFacts(tx, token.ownerId, input, ports.catalogs),
            groups =
              assignment && ports.catalogs
                ? await ports.catalogs.trailerGroupsInTransaction(
                    tx,
                    input.game,
                    [
                      ...assignment.limits.trailers.typeIds,
                      ...facts.trailers.items.flatMap((f) =>
                        f.status === "known" ? [f.value.entityId] : [],
                      ),
                    ],
                    assignment.limits.trailers.basis,
                  )
                : {};
          let eventExempt = false,
            eventUnresolved = false;
          if (input.eventId) {
            try {
              const event = await ports.events?.currentAssociationInTransaction(tx, {
                eventId: input.eventId,
                memberId: token.ownerId,
                game: input.game,
              });
              eventExempt = !!event?.confirmedEvent && !event.reviewRequired;
              eventUnresolved = !eventExempt;
            } catch (error) {
              if ([403, 404, 409].includes(Number((error as { statusCode?: number }).statusCode)))
                eventUnresolved = true;
              else throw error;
            }
          }
          const checked = configured
            ? checkPreview(
                {
                  ...configured.assignment.limits,
                  cargoDamageMaxPercent: configured.cargoDamageMaxPercent,
                },
                facts,
                input,
                groups,
                eventExempt,
              )
            : {
                outcome: "unknown" as const,
                rules: [],
                reasons: [
                  ports.qualifications ? "assignment_missing" : "module_unavailable",
                ] as S["Preview"]["reasons"],
              };
          if (eventUnresolved) checked.reasons.push("event_unresolved");
          const evaluatedAt = now();
          return {
            contract: "1.0",
            securityScope: scope,
            requestId: input.requestId,
            contextRevision: input.contextRevision,
            evidenceRevision: input.evidenceRevision,
            evaluatedAt: evaluatedAt.toISOString(),
            basis: assignment
              ? historical
                ? "historical_assignment"
                : "current_projection"
              : "unavailable",
            assignment,
            ...checked,
            trailerDisplay:
              assignment && ports.catalogs
                ? await ports.catalogs.companionTrailerDisplayInTransaction(
                    tx,
                    input.game,
                    [
                      ...assignment.limits.trailers.typeIds,
                      ...facts.trailers.items.flatMap((f) =>
                        f.status === "known" ? [f.value.entityId] : [],
                      ),
                    ],
                    now().toISOString(),
                  )
                : [],
            eventExempt,
            applicability: {
              expiresAt: new Date(evaluatedAt.getTime() + 5000).toISOString(),
              contextRevision: input.contextRevision,
              ...previewDistanceEnvelope(input, assignment?.limits ?? null, eventExempt),
              qualificationRevision: await ports.trips.companion.revision.read(tx, token.ownerId),
              requiresQualificationRefresh: true,
            },
            provisional: true,
          };
        },
        ticket,
      );
    },
    async results(
      bearer: string | undefined,
      ip: string,
      input: S["ResultBatchInput"],
      ticket?: object,
    ): Promise<S["ResultBatch"]> {
      return ports.telemetry.companion(
        bearer,
        ip,
        async (tx, token, scope) => {
          const revision = await ports.trips.companion.revision.read(tx, token.ownerId),
            items: S["Result"][] = [];
          for (const request of input.items) {
            const found = await ports.trips.companion.source(tx, token.ownerId, request);
            const retained =
              found && ports.assessments ? await ports.assessments.read(tx, found.root) : null;
            const value = await assessment(tx, retained?.decision ?? null);
            const pending =
              !!found &&
              (found.root.assessmentPending || !!retained?.eventStale || !ports.assessments);
            const predecessor =
              !!value &&
              (value.factId !== found?.root.currentFactId ||
                value.factId !== found?.requested?.factId ||
                value.sourceMessageId !== found?.requested?.id ||
                pending ||
                !!found?.root.correctionPending);
            const presentation = (value?.trailerDisplay ?? [])
              .map(({ asOf: _asOf, ...display }) => display)
              .sort((a, b) => a.id.localeCompare(b.id));
            const version = `${revision}.${sign([scope, revision, enabled(), request.source, request.revision, request.eventId, presentation])}`;
            const unchanged = request.ifVersion === version;
            items.push({
              source: request.source,
              requestedRevision: request.revision,
              requestedEventId: request.eventId,
              version,
              resultRevision: revision,
              unchanged,
              receipt: found?.requested ? "received" : "not_received",
              state: !found?.requested
                ? "not_received"
                : found.root.reviewHold ||
                    found.root.correctionPending ||
                    found.root.decision === "pending_review"
                  ? "review"
                  : pending
                    ? "processing"
                    : value
                      ? "decided"
                      : "processing",
              requestedSourceMessageId: found?.requested?.id ?? null,
              latestSourceRevision: found ? Number(found.source.latestRevision) : null,
              canonicalTripId: found?.root.id ?? null,
              sourceOutcome: found?.root.outcome ?? null,
              companyDecision: found?.root.decision ?? "unassessed",
              assessmentPending: pending,
              correctionPending: found?.root.correctionPending ?? false,
              assessmentBasis: value ? (predecessor ? "predecessor" : "current") : "none",
              assessment: unchanged ? null : value,
              credit:
                unchanged || !found?.credit
                  ? null
                  : {
                      credited: found.credit.credited,
                      trips: found.credit.credited ? 1 : 0,
                      actualDistanceM:
                        found.credit.actualDistanceM === null
                          ? null
                          : decimal(found.credit.actualDistanceM),
                      assignmentId: found.credit.assignmentId,
                    },
            });
          }
          return {
            contract: "1.0",
            securityScope: scope,
            requestId: input.requestId,
            asOf: now().toISOString(),
            refreshAfterSeconds: 5,
            items,
          };
        },
        ticket,
      );
    },
  };
}
export type TelemetryCompanion = ReturnType<typeof createTelemetryCompanion>;
