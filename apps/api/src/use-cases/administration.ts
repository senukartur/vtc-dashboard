import { createAudit, type UnitOfWork } from "@vtc/db";
import { type Actor, type Identity, identityError } from "../modules/identity/service.js";
import { createQualificationInitialization } from "../modules/qualifications/initialization.js";
import { pagination, type Page } from "../modules/qualifications/pagination.js";

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
) {
  const qualifications = createQualificationInitialization(unit),
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
    async members(actor: Actor, options: Page & { status?: "active" | "inactive" }, id?: string) {
      const paging = page(actor, ["members", options.status ?? "all"], options);
      return identity.transaction(async (tx) => {
        const rows = await identity.administrationMembersInTransaction(
          tx,
          actor,
          paging.after?.id ?? null,
          id ? 1 : paging.limit + 1,
          options.status,
          id,
        );
        if (id && !rows.length) throw identityError(404);
        const selected = rows.slice(0, paging.limit);
        const assignments = await qualifications.administrationProjection(
          tx,
          selected.map((row) => row.id),
        );
        const items = selected.map(({ id, nickname, roles, ...row }) => ({
          ...row,
          profile: {
            member: { id, nickname, roles, formerMember: row.status === "inactive" },
            qualifications: assignments.get(id) ?? [],
          },
        }));
        const result = paging.finish(
          rows.map((row) => ({ id: row.id })),
          (row) => ({ id: row.id, time: null }),
        );
        return { items, nextCursor: result.nextCursor };
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
