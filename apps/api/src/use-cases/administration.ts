import type { components } from "@vtc/contracts";
import { createAudit, type TxContext, type UnitOfWork } from "@vtc/db";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { Admissions } from "../modules/admissions/service.js";
import { type Actor, type Identity, identityError } from "../modules/identity/service.js";
import { createQualificationInitialization } from "../modules/qualifications/initialization.js";
import { pagination, type Page } from "../modules/qualifications/pagination.js";
import { createTripActivity } from "../modules/trips/activity.js";

const MEMBER_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface MemberCounterSources {
  tripActivity?: {
    hasAcceptedReportingActivity(
      tx: TxContext,
      ownerRef: SQLWrapper,
      fromInclusive: string,
      throughInclusive: string,
    ): SQL;
  };
  admissions?: Pick<Admissions, "usableInvitationCountInTransaction">;
}

export function createAdministration(
  unit: UnitOfWork,
  identity: Identity,
  enabled: {
    telemetry: boolean;
    manual: boolean;
    qualifications: boolean;
    externalIdentities: boolean;
    admissions: boolean;
    mail: boolean;
  },
  // Kept apart from `enabled`, which is returned as the SourceCapabilities contract.
  tripsEnabled = false,
  counterSources: MemberCounterSources = {},
) {
  const reportingActivity = tripsEnabled ? counterSources.tripActivity : undefined;
  const admissions = enabled.admissions ? counterSources.admissions : undefined;
  const qualifications = createQualificationInitialization(unit),
    // The runtime database role can read trips only where the Trips module is configured.
    activity = tripsEnabled ? createTripActivity(unit) : undefined,
    audit = createAudit(unit),
    page = pagination(identity.config.secret, "administration");
  async function settings(actor: Actor) {
    return identity.transaction(async (tx) => {
      const company = await identity.companySettingsInTransaction(tx, actor);
      const ready = await qualifications.administrationReadiness(tx, new Date().toISOString());
      const missingSetup = [
        ...(company.reportingTimezone ? [] : ["company_reporting_timezone"]),
        ...(ready ? [] : ["qualification_configuration"]),
      ];
      return { ...company, launchReady: missingSetup.length === 0, missingSetup };
    });
  }
  return {
    settings,
    async reinstatementOptions(actor: Actor) {
      return identity.transaction(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "members.manage");
        return { levels: await qualifications.administrationLevels(tx) };
      });
    },
    async personalCapabilities(actor: Actor) {
      return identity.transaction(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "company.read");
        return { telemetry: enabled.telemetry, externalIdentities: enabled.externalIdentities };
      });
    },
    async updateSettings(actor: Actor, key: string, expected: number, timezone: string) {
      await identity.updateCompanySettings(actor, key, expected, timezone);
      return settings(actor);
    },
    async members(
      actor: Actor,
      options: Page & {
        status?: "active" | "inactive";
        role?: "trainee" | "driver" | "dispatcher" | "deputy_director" | "director";
        search?: string;
      },
      id?: string,
    ) {
      const paging = page(
        actor,
        ["members", options.status ?? "all", options.role ?? "any", options.search ?? null],
        options,
      );
      return identity.transaction(async (tx) => {
        const { rows, counts } = await identity.administrationMembersInTransaction(tx, actor, {
          after: paging.after?.id ?? null,
          limit: id ? 1 : paging.limit + 1,
          status: options.status,
          targetId: id,
          role: options.role,
          search: options.search,
          reportingActivity: reportingActivity
            ? (ownerRef, countedAt) =>
                reportingActivity.hasAcceptedReportingActivity(
                  tx,
                  ownerRef,
                  new Date(Date.parse(countedAt) - MEMBER_ACTIVITY_WINDOW_MS).toISOString(),
                  countedAt,
                )
            : undefined,
        });
        if (id && !rows.length) throw identityError(404);
        const statusCounts: components["schemas"]["AdminMemberStatusCounts"] | undefined = counts
          ? { ...counts.statusCounts }
          : undefined;
        if (
          counts &&
          statusCounts &&
          admissions &&
          counts.currentCapabilities.includes("applications.manage")
        ) {
          statusCounts.invited =
            options.role !== undefined
              ? 0
              : await admissions.usableInvitationCountInTransaction(
                  tx,
                  actor,
                  counts.countedAt,
                  options.search,
                );
        }
        const selected = rows.slice(0, paging.limit),
          ids = selected.map((row) => row.id);
        // Row projection locks follow company -> sorted members (share) -> qualifications.
        const assignments = await qualifications.administrationProjection(tx, ids);
        const lastAccepted = activity
          ? await activity.lastAcceptedInTransaction(tx, ids)
          : new Map<string, string>();
        const items = selected.map(({ id, nickname, roles, ...row }) => ({
          ...row,
          lastAcceptedTripAt: lastAccepted.get(id) ?? null,
          profile: {
            member: { id, nickname, roles, formerMember: row.status === "inactive" },
            qualifications: assignments.get(id) ?? [],
          },
        }));
        const result = paging.finish(
          rows.map((row) => ({ id: row.id })),
          (row) => ({ id: row.id, time: null }),
        );
        return { items, nextCursor: result.nextCursor, ...(statusCounts ? { statusCounts } : {}) };
      });
    },
    async audit(actor: Actor, options: Page) {
      const paging = page(actor, ["audit"], options);
      return identity.transaction(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "members.manage");
        const company = await identity.onboardingCompany(tx);
        const rows = await audit.list(tx, {
          companyId: company.id,
          limit: paging.limit + 1,
          after: paging.after,
        });
        return paging.finish(rows, (row) => ({ id: row.id, time: row.occurredAt }));
      });
    },
    async sources(actor: Actor) {
      return identity.transaction(async (tx) => {
        await identity.authorizeInTransaction(tx, actor, "connections.manage");
        return {
          sources: [
            {
              provider: "ets2telemetry" as const,
              implemented: true,
              runtimeEnabled: enabled.telemetry,
              ownership: "personal" as const,
            },
            {
              provider: "manual" as const,
              implemented: true,
              runtimeEnabled: enabled.manual,
              ownership: "personal" as const,
            },
            {
              provider: "trucky" as const,
              implemented: false,
              runtimeEnabled: false,
              ownership: "company" as const,
            },
            {
              provider: "vtcbase" as const,
              implemented: false,
              runtimeEnabled: false,
              ownership: "company" as const,
            },
          ],
          ...enabled,
        };
      });
    },
  };
}
export type Administration = ReturnType<typeof createAdministration>;
