import { randomBytes } from "node:crypto";
import { newId, type TxContext } from "@vtc/db";
import { expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { registerAdministrationRoutes } from "../../apps/api/src/modules/identity/admin-http.ts";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import {
  type Actor,
  type Identity,
  identityError,
} from "../../apps/api/src/modules/identity/service.ts";
import { pagination } from "../../apps/api/src/modules/qualifications/pagination.ts";
import { registerWorkspaceSummaryRoutes } from "../../apps/api/src/modules/workspace-summary/http.ts";
import type { Administration } from "../../apps/api/src/use-cases/administration.ts";
import { createWorkspaceSummary } from "../../apps/api/src/use-cases/workspace-summary.ts";
import { frozenAttempt } from "../../apps/web/src/features/admin/attempt.ts";
import { administrationTranslations } from "../../apps/web/src/features/admin/translations.ts";

test("administration keysets are domain-separated and scoped to effective limit", () => {
  const key = randomBytes(32).toString("hex"),
    actor = {
      userId: newId(),
      sessionId: newId(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: [],
    },
    page = pagination(key, "administration"),
    rows = [{ id: newId() }, { id: newId() }];
  const cursor = page(actor, ["members", "active"], { limit: 1 }).finish(rows, (row) => ({
    id: row.id,
    time: null,
  })).nextCursor as string;
  expect(page(actor, ["members", "active"], { limit: 1, cursor }).after?.id).toBe(rows[0]?.id);
  expect(() => page(actor, ["members", "active"], { limit: 2, cursor })).toThrow();
  expect(() => pagination(key)(actor, ["members", "active"], { limit: 1, cursor })).toThrow();
});
test("uncertain commands freeze target/body/key/etag until explicitly resolved", () => {
  const first = frozenAttempt(
    "/admin/members/fictional/roles",
    "PUT",
    { roles: ["driver"] },
    '"v2"',
    null,
  );
  const retry = frozenAttempt(
    "/admin/members/different/roles",
    "PUT",
    { roles: ["dispatcher"] },
    '"v99"',
    first,
  );
  expect(retry).toBe(first);
  expect(retry.body).toEqual({ roles: ["driver"] });
  expect(retry.etag).toBe('"v2"');
  const fresh = frozenAttempt(first.path, first.method, first.body, first.etag, null);
  expect(fresh.key).not.toBe(first.key);
});

test("administration HMAC accepts the identity owner's non-hex secret without collapsing keys", () => {
  const actor = {
      userId: newId(),
      sessionId: newId(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: [],
    },
    first = pagination("first-fictional-nonhex-identity-secret", "administration"),
    second = pagination("second-fictional-nonhex-identity-secret", "administration"),
    rows = [{ id: newId() }, { id: newId() }];
  const cursor = first(actor, ["members"], { limit: 1 }).finish(rows, (row) => ({
    id: row.id,
    time: null,
  })).nextCursor as string;
  expect(first(actor, ["members"], { cursor, limit: 1 }).after?.id).toBe(rows[0]?.id);
  expect(() => second(actor, ["members"], { cursor, limit: 1 })).toThrow();
});
test("administration RU/EN resources cover the same operational states", () => {
  function keys(value: object, prefix = ""): string[] {
    return Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
      )
      .sort();
  }
  expect(keys(administrationTranslations.en)).toEqual(keys(administrationTranslations.ru));
});

const snapshot = "2026-10-18T11:12:13.123Z";
test("audit selects a closed response schema for the requested view", async () => {
  const { actor, identity } = workspaceFixture(["director"]);
  const app = await createApp({ checkReadiness: async () => true });
  const legacyRow = {
    id: newId(),
    action: "configuration.changed",
    actorId: actor.userId,
    subjectId: newId(),
    occurredAt: snapshot,
  };
  const stagedRow = {
    ...legacyRow,
    actorNickname: "Fictional Director",
    objectName: "Yukon Union",
    objectType: "company",
    details: { before: { reportingTimezone: null }, after: { reportingTimezone: "Europe/Warsaw" } },
  };
  const audit = vi.fn(async () => ({ items: [legacyRow], nextCursor: null }));
  const auditStage3 = vi.fn(async () => ({ items: [stagedRow], nextCursor: null }));
  await registerAdministrationRoutes(
    app,
    {
      ...identity,
      config: { secret: "fictional-response-test-secret", origin: "http://127.0.0.1:4173" },
      rateLimit: async () => {},
      authenticate: async () => actor,
    } as unknown as Identity,
    { audit, auditStage3 } as unknown as Administration,
  );
  const url = "/api/v1/admin/audit";
  try {
    for (const [query, data] of [
      ["?limit=1", { items: [legacyRow], nextCursor: null }],
      [
        "?view=stage3&limit=1&action=configuration.changed",
        { items: [stagedRow], nextCursor: null },
      ],
    ] as const) {
      const response = await app.inject({ url: `${url}${query}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().data).toEqual(data);
    }
    expect(audit).toHaveBeenCalledWith(expect.anything(), { limit: 1 });
    expect(auditStage3).toHaveBeenCalledWith(expect.anything(), {
      view: "stage3",
      limit: 1,
      action: "configuration.changed",
    });
    auditStage3.mockResolvedValueOnce({
      items: [{ ...stagedRow, ...{ privateValue: "fixture" } }],
      nextCursor: null,
    });
    const invalid = await app.inject({ url: `${url}?view=stage3` });
    expect(invalid.statusCode).toBe(500);
    expect(invalid.headers["cache-control"]).toBe("no-store");
    expect(invalid.json().error.code).toBe("INTERNAL_ERROR");
    expect(invalid.body).not.toContain("privateValue");
  } finally {
    await app.close();
  }
});

function workspaceFixture(roles: Role[]) {
  const tx = {} as TxContext;
  const actor: Actor = {
    userId: newId(),
    sessionId: newId(),
    accessEpoch: 1,
    credentialEpoch: 1,
    capabilities: capabilities(["driver", "director"]),
  };
  const current = { ...actor, capabilities: capabilities(roles), locale: "en" as const };
  const now = vi.fn(() => new Date(snapshot));
  const openTransaction = vi.fn(() => tx);
  const transaction = <T>(read: (tx: TxContext) => Promise<T>) => read(openTransaction());
  const authorizeInTransaction = vi.fn(async () => current);
  return {
    actor,
    current,
    tx,
    now,
    openTransaction,
    identity: { transaction, authorizeInTransaction },
  };
}

test("workspace reads authorized sources with one transaction and clock and projects only approved fields", async () => {
  const { actor, current, tx, now, openTransaction, identity } = workspaceFixture([
    "driver",
    "director",
  ]);
  const trip = { tripId: newId(), latestReturnReason: null },
    draft = { draftId: newId(), updatedAt: snapshot },
    event = { eventId: newId(), title: "Fictional Convoy", startsAt: "2026-10-19T10:00:00.000Z" };
  const sources = {
    acceptance: {
      workspaceReturnedTripsInTransaction: vi.fn(async () => ({
        count: 6,
        items: [{ ...trip, evidence: ["fictional reference"] }],
      })),
    },
    manualReports: {
      workspaceEditingDraftsInTransaction: vi.fn(async () => ({
        count: 8,
        items: [{ ...draft, evidence: ["fictional reference"] }],
      })),
    },
    events: {
      workspaceUnansweredEventsInTransaction: vi.fn(async () => ({
        count: 11,
        items: [{ ...event, declineReason: "Fictional private reason" }],
      })),
    },
    trips: {
      workspaceReviewQueueInTransaction: vi.fn(async () => ({
        count: 10,
        oldestCreatedAt: "2026-10-18T11:12:10.456Z",
      })),
    },
    admissions: { submittedCountInTransaction: vi.fn(async () => 12) },
  };
  const workspace = createWorkspaceSummary(identity, sources, now);
  expect(await workspace.read(actor)).toEqual({
    computedAt: snapshot,
    tripsNeedingFixes: { count: 6, items: [trip] },
    unfinishedManualDrafts: { count: 8, items: [draft] },
    unansweredUpcomingEvents: { count: 11, items: [event] },
    reviewQueue: { count: 10, oldestAgeSeconds: 2 },
    newApplicationsCount: 12,
  });
  expect(openTransaction).toHaveBeenCalledOnce();
  expect(identity.authorizeInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    actor,
    "company.read",
  );
  expect(now).toHaveBeenCalledOnce();
  expect(now.mock.invocationCallOrder[0]).toBeGreaterThan(
    identity.authorizeInTransaction.mock.invocationCallOrder[0] as number,
  );
  expect(sources.acceptance.workspaceReturnedTripsInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    actor.userId,
  );
  expect(sources.manualReports.workspaceEditingDraftsInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    actor.userId,
  );
  expect(sources.events.workspaceUnansweredEventsInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    actor.userId,
    snapshot,
  );
  expect(sources.trips.workspaceReviewQueueInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    actor.userId,
  );
  expect(sources.admissions.submittedCountInTransaction).toHaveBeenCalledExactlyOnceWith(
    tx,
    current,
  );
});

test.each([
  ["driver", true, false, false],
  ["dispatcher", false, true, false],
  ["deputy_director", false, true, true],
  ["director", false, true, true],
] as const)(
  "workspace uses the current %s capabilities and omits disabled sources",
  async (role, drafts, queue, applications) => {
    const { actor, now, identity } = workspaceFixture([role]);
    const preview = vi.fn(async () => ({ count: 0, items: [] }));
    const review = vi.fn(async () => ({ count: 0, oldestCreatedAt: null }));
    const submitted = vi.fn(async () => 0);
    const upcoming = vi.fn(async () => ({ count: 0, items: [] }));
    const workspace = createWorkspaceSummary(
      identity,
      {
        acceptance: { workspaceReturnedTripsInTransaction: preview },
        manualReports: { workspaceEditingDraftsInTransaction: preview },
        trips: { workspaceReviewQueueInTransaction: review },
        admissions: { submittedCountInTransaction: submitted },
        ...(role !== "driver"
          ? { events: { workspaceUnansweredEventsInTransaction: upcoming } }
          : {}),
      },
      now,
    );

    expect(await workspace.read(actor)).toEqual({
      computedAt: snapshot,
      tripsNeedingFixes: { count: 0, items: [] },
      ...(drafts ? { unfinishedManualDrafts: { count: 0, items: [] } } : {}),
      ...(queue ? { reviewQueue: { count: 0, oldestAgeSeconds: null } } : {}),
      ...(applications ? { newApplicationsCount: 0 } : {}),
    });
    expect(preview).toHaveBeenCalledTimes(drafts ? 2 : 1);
    expect(review).toHaveBeenCalledTimes(queue ? 1 : 0);
    expect(submitted).toHaveBeenCalledTimes(applications ? 1 : 0);
    expect(upcoming).not.toHaveBeenCalled();
  },
);

test("workspace route applies current session authority and no-store to success and failures", async () => {
  const { actor, identity, now } = workspaceFixture(["director"]);
  const submittedCountInTransaction = vi.fn(async () => 0);
  const authenticate = vi.fn(async (headers: Headers) => {
    if (!headers.get("cookie")) throw identityError(401);
    return actor;
  });
  const workspace = createWorkspaceSummary(
    identity,
    {
      admissions: { submittedCountInTransaction },
    },
    now,
  );
  const app = await createApp({ checkReadiness: async () => true });
  await registerWorkspaceSummaryRoutes(app, { authenticate }, workspace);
  const url = "/api/v1/me/workspace-summary",
    headers = { cookie: "fictional-session=fixture" };
  try {
    for (const [statusCode, code, hasCookie] of [
      [401, "UNAUTHORIZED", false],
      [401, "UNAUTHORIZED", true],
      [403, "FORBIDDEN", true],
    ] as const) {
      if (hasCookie)
        identity.authorizeInTransaction.mockRejectedValueOnce(identityError(statusCode));
      const response = await app.inject(hasCookie ? { url, headers } : { url });
      expect(response.statusCode).toBe(statusCode);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json().error.code).toBe(code);
    }
    expect(now).not.toHaveBeenCalled();
    expect(submittedCountInTransaction).not.toHaveBeenCalled();

    const success = await app.inject({ url, headers });
    expect(success.statusCode).toBe(200);
    expect(success.headers["cache-control"]).toBe("no-store");
    expect(success.json()).toEqual({
      data: { computedAt: snapshot, newApplicationsCount: 0 },
      meta: { requestId: expect.any(String) },
    });

    submittedCountInTransaction.mockRejectedValueOnce(identityError(503));
    const unavailable = await app.inject({ url, headers });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    expect(unavailable.json()).toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        messageKey: "errors.service_unavailable",
        retryable: true,
      },
      meta: { requestId: expect.any(String) },
    });
  } finally {
    await app.close();
  }
});
