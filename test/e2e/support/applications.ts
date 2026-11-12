import type { Page, Route } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../../apps/web/src/features/account/fixtures.ts";
import { inertNotifications } from "./notifications.ts";

type S = components["schemas"];
export const ids = {
  submitted: "a6300000-0000-4000-8000-000000000001",
  second: "a6300000-0000-4000-8000-000000000002",
  approved: "a6300000-0000-4000-8000-000000000003",
  rejected: "a6300000-0000-4000-8000-000000000004",
  prior: "a6300000-0000-4000-8000-000000000005",
  invitation: "b6300000-0000-4000-8000-000000000001",
  reissued: "b6300000-0000-4000-8000-000000000002",
  delivery: "c6300000-0000-4000-8000-000000000001",
  reviewer: "d6300000-0000-4000-8000-000000000001",
  decision: "e6300000-0000-4000-8000-000000000001",
} as const;
export const names = {
  submitted: "Fictional Birch Run",
  second: "Fictional Aspen Ridge",
  approved: "Fictional Pine Echo",
  rejected: "Fictional Cedar Vale",
} as const;
export const rejectedReason = "Fictional closed Steam profile, games are not visible";
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-applications" } });
const day = 86_400_000;
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString();

function application(
  id: string,
  nickname: string,
  status: S["Application"]["status"],
  extra: Partial<S["Application"]> = {},
): S["Application"] {
  return {
    id,
    version: 1,
    status,
    submittedAt: "2026-10-30T09:30:00.000Z",
    fields: {
      nickname,
      email: `${nickname.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
      steamProfileUrl: `https://steamcommunity.com/id/${nickname.toLowerCase().replaceAll(" ", "-")}`,
      games: ["ets2", "ats"],
      discord: null,
      introduction: null,
    },
    decisionReason: null,
    invitationId: null,
    decision: null,
    ...extra,
  };
}
function decision(outcome: "approve" | "reject", reason: string | null): S["ApplicationDecision"] {
  return {
    id: ids.decision,
    outcome,
    reason,
    reviewerId: ids.reviewer,
    decidedAt: "2026-10-31T15:45:00.000Z",
    applicationVersion: 1,
    deliveryId: null,
  };
}
export type Command = {
  method: string;
  path: string;
  body: string | null;
  key: string | undefined;
  ifMatch: string | undefined;
  csrf: string | undefined;
  contentType: string | undefined;
};
export type ApplicationsOptions = {
  capabilities?: string[];
  invitation?: Partial<S["Invitation"]>;
  delivery?: Partial<S["MailDelivery"]>;
  mailEnabled?: boolean;
  statusCounts?: S["AdminApplicationStatusCounts"];
};
/**
 * Synthetic staff applications API: an applications.manage session, three statuses, an approved
 * application with one invitation and an optional mail delivery. Every command is recorded.
 */
export async function mockApplications(page: Page, options: ApplicationsOptions = {}) {
  const now = Date.now();
  const state = {
    apps: [
      application(ids.submitted, names.submitted, "submitted", {
        fields: {
          ...application(ids.submitted, names.submitted, "submitted").fields,
          discord: "fictional_birch",
          introduction:
            "Вожу в основном по Скандинавии и Иберии, люблю длинные ночные рейсы с тяжёлыми прицепами.",
        },
      }),
      application(ids.second, names.second, "submitted", {
        submittedAt: "2026-10-29T18:05:00.000Z",
        fields: { ...application(ids.second, names.second, "submitted").fields, games: ["ats"] },
      }),
      application(ids.approved, names.approved, "approved", {
        invitationId: ids.invitation,
        decision: decision("approve", null),
      }),
      application(ids.rejected, names.rejected, "rejected", {
        decisionReason: rejectedReason,
        decision: decision("reject", rejectedReason),
      }),
    ],
    invitations: new Map<string, S["Invitation"]>([
      [
        ids.invitation,
        {
          id: ids.invitation,
          version: 1,
          applicationId: ids.approved,
          expiresAt: iso(now + 6 * day),
          state: "active",
          emailDelivery: "not_requested",
          deliveryId: null,
          ...options.invitation,
        },
      ],
    ]),
    delivery: options.delivery
      ? ({
          id: ids.delivery,
          kind: "invitation",
          state: "failed",
          version: 1,
          attempts: 1,
          createdAt: iso(now - day),
          updatedAt: iso(now - day),
          expiresAt: iso(now + 6 * day),
          nextAttemptAt: null,
          recovery: null,
          ...options.delivery,
        } satisfies S["MailDelivery"])
      : null,
    capabilities: options.capabilities,
    mailEnabled: options.mailEnabled ?? true,
    listStatus: 200,
    listEmpty: false,
    listGate: null as Promise<void> | null,
    detailStatus: 200,
    commandOutcomes: [] as (number | "abort")[],
    commands: [] as Command[],
    reads: [] as string[],
  };
  const etag = (prefix: string, version: number) => ({ ETag: `"${prefix}-${version}"` });
  const find = (id: string) => state.apps.find((app) => app.id === id);
  await page.route("**/api/v1/**", async (route: Route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/v1", ""),
      method = request.method();
    if (path === "/me") {
      const self = accountFixture();
      self.data.member.roles = ["driver", "deputy_director"];
      self.data.capabilities = (state.capabilities ?? [
        ...self.data.capabilities,
        "applications.manage",
      ]) as typeof self.data.capabilities;
      return route.fulfill({ json: self, headers: { ETag: '"v1"' } });
    }
    if (path === "/auth/csrf")
      return route.fulfill({ json: envelope({ token: "NONFUNCTIONAL_FIXTURE" }) });
    if (method === "GET") state.reads.push(path);
    if (method === "GET" && path === "/admin/applications") {
      if (state.listGate) await state.listGate;
      if (state.listStatus !== 200)
        return route.fulfill({
          status: state.listStatus,
          json: { error: { code: "PRIVATE_SENTINEL" } },
        });
      const status = url.searchParams.get("status");
      return route.fulfill({
        json: envelope({
          items: state.listEmpty ? [] : state.apps.filter((app) => app.status === status),
          nextCursor: null,
          ...(options.statusCounts ? { statusCounts: options.statusCounts } : {}),
        }),
      });
    }
    const detail = /^\/admin\/applications\/([^/]+)(\/history|\/decisions)?$/.exec(path);
    if (detail?.[1]) {
      const app = find(detail[1]);
      if (!app)
        return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
      if (method === "GET" && !detail[2]) {
        if (state.detailStatus !== 200)
          return route.fulfill({
            status: state.detailStatus,
            json: { error: { code: "PRIVATE_SENTINEL" } },
          });
        return route.fulfill({ json: envelope(app), headers: etag("app", app.version) });
      }
      if (method === "GET" && detail[2] === "/history") {
        const prior = application(ids.prior, app.fields.nickname, "rejected", {
          submittedAt: "2026-09-02T08:00:00.000Z",
          decisionReason: rejectedReason,
          decision: decision("reject", rejectedReason),
        });
        return route.fulfill({ json: envelope({ items: [app, prior], nextCursor: null }) });
      }
      if (method === "POST" && detail[2] === "/decisions") {
        const outcome = record(route);
        if (outcome) return outcome;
        const body = JSON.parse(request.postData() ?? "{}") as {
          decision: "approve" | "reject";
          reason?: string;
        };
        app.version += 1;
        if (body.decision === "approve") {
          app.status = "approved";
          app.invitationId = ids.invitation;
          app.decision = decision("approve", null);
          state.invitations.set(ids.invitation, {
            id: ids.invitation,
            version: 1,
            applicationId: app.id,
            expiresAt: iso(Date.now() + 7 * day),
            state: "active",
            emailDelivery: "not_requested",
            deliveryId: null,
          });
        } else {
          app.status = "rejected";
          app.decisionReason = body.reason ?? null;
          app.decision = decision("reject", body.reason ?? null);
        }
        return route.fulfill({ json: envelope(app), headers: etag("app", app.version) });
      }
    }
    const invitation =
      /^\/admin\/invitations\/([^/]+)(\/copy-link|\/email-deliveries|\/reissue)?$/.exec(path);
    if (invitation?.[1]) {
      const current = state.invitations.get(invitation[1]);
      if (!current)
        return route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
      if (method === "GET" && !invitation[2])
        return route.fulfill({ json: envelope(current), headers: etag("inv", current.version) });
      if (method === "POST") {
        const outcome = record(route);
        if (outcome) return outcome;
        if (invitation[2] === "/copy-link")
          return route.fulfill({
            json: envelope({
              invitationId: current.id,
              link: `https://example.invalid/invitations/${current.id}.synthetic-one-time-token-for-layout-checks-only`,
              expiresAt: current.expiresAt,
            }),
          });
        if (invitation[2] === "/email-deliveries") {
          Object.assign(current, {
            version: current.version + 1,
            emailDelivery: "queued",
            deliveryId: ids.delivery,
          });
          state.delivery = {
            id: ids.delivery,
            kind: "invitation",
            state: "queued",
            version: 1,
            attempts: 0,
            createdAt: iso(Date.now()),
            updatedAt: iso(Date.now()),
            expiresAt: current.expiresAt,
            nextAttemptAt: null,
            recovery: null,
          };
          return route.fulfill({ json: envelope(current), headers: etag("inv", current.version) });
        }
        if (invitation[2] === "/reissue") {
          Object.assign(current, { version: current.version + 1, state: "revoked" });
          const replacement: S["Invitation"] = {
            id: ids.reissued,
            version: 1,
            applicationId: current.applicationId,
            expiresAt: iso(Date.now() + 7 * day),
            state: "active",
            emailDelivery: "not_requested",
            deliveryId: null,
          };
          state.invitations.set(ids.reissued, replacement);
          const app = find(current.applicationId);
          if (app) Object.assign(app, { invitationId: ids.reissued, version: app.version + 1 });
          return route.fulfill({ json: envelope(replacement), headers: etag("inv", 1) });
        }
      }
    }
    if (path === "/admin/source-capabilities")
      return route.fulfill({
        json: envelope({
          sources: (["ets2telemetry", "manual", "trucky", "vtcbase"] as const).map((provider) => ({
            provider,
            implemented: provider === "ets2telemetry" || provider === "manual",
            runtimeEnabled: provider === "ets2telemetry" || provider === "manual",
            ownership: provider === "trucky" || provider === "vtcbase" ? "company" : "personal",
          })),
          telemetry: true,
          manual: true,
          qualifications: true,
          externalIdentities: true,
          admissions: true,
          mail: state.mailEnabled,
        }),
      });
    const mail = /^\/mail-deliveries\/([^/]+)(\/resends)?$/.exec(path);
    if (mail && state.delivery && mail[1] === state.delivery.id) {
      if (method === "GET")
        return route.fulfill({
          json: envelope(state.delivery),
          headers: etag("mail", state.delivery.version),
        });
      const outcome = record(route);
      if (outcome) return outcome;
      state.delivery = { ...state.delivery, state: "queued", version: state.delivery.version + 1 };
      return route.fulfill({
        json: envelope({ id: state.delivery.id, version: state.delivery.version }),
      });
    }
    return route.fulfill({ status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } });
  });
  /** Records the command; returns a fulfilled outcome when one is queued for this attempt. */
  function record(route: Route) {
    const request = route.request(),
      headers = request.headers();
    state.commands.push({
      method: request.method(),
      path: new URL(request.url()).pathname.replace("/api/v1", ""),
      body: request.postData(),
      key: headers["idempotency-key"],
      ifMatch: headers["if-match"],
      csrf: headers["x-csrf-token"],
      contentType: headers["content-type"],
    });
    const outcome = state.commandOutcomes.shift();
    if (outcome === "abort") return route.abort("failed");
    if (typeof outcome === "number")
      return route.fulfill({
        status: outcome,
        json: {
          error: { code: "SYNTHETIC_CONFLICT", messageKey: "errors.conflict", retryable: false },
          meta: { requestId: "synthetic-applications" },
        },
      });
    return undefined;
  }
  return state;
}
