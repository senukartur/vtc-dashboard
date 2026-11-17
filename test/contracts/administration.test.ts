import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
test("leadership confirmation cannot supply a successor and safe audit rejects private payload", () => {
  const id = "03800000-0000-4000-8000-000000000001";
  expect(valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL" })).toBe(true);
  expect(
    valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL", successorId: id }),
  ).toBe(false);
  const audit = {
    id,
    actorId: null,
    action: "configuration.changed",
    subjectId: id,
    occurredAt: "2026-10-26T12:00:00.000Z",
  };
  expect(valid("AuditEntry")(audit)).toBe(true);
  for (const field of ["reason", "email", "token", "payload", "link"])
    expect(valid("AuditEntry")({ ...audit, [field]: "PRIVATE_PLACEHOLDER" })).toBe(false);
  expect(valid("ReinstateInput")({ roles: ["driver"], assignments: [], reason: "Fictional" })).toBe(
    false,
  );
});
test("leadership challenge state exposes only bounded safe pending fields and resend time", () => {
  const id = "06500000-0000-4000-8000-000000000001",
    successor = {
      id: "06500000-0000-4000-8000-000000000002",
      nickname: "Fictional Successor",
      formerMember: false,
      roles: ["driver"],
    },
    pending = {
      id,
      successor,
      expiresAt: "2026-10-26T12:10:00.000Z",
      attemptsRemaining: 5,
    },
    state = valid("LeadershipChallengeState");
  expect(valid("MemberSummary")(successor)).toBe(true);
  for (const attemptsRemaining of [1, 2, 3, 4, 5])
    expect(
      state({
        pending: { ...pending, attemptsRemaining },
        resendAvailableAt: "2026-10-26T12:01:00.000Z",
      }),
    ).toBe(true);
  expect(state({ pending: null, resendAvailableAt: null })).toBe(true);
  expect(state({ pending: null, resendAvailableAt: "2026-10-26T13:00:00.000Z" })).toBe(true);
  for (const attemptsRemaining of [0, 6, 2.5])
    expect(state({ pending: { ...pending, attemptsRemaining }, resendAvailableAt: null })).toBe(
      false,
    );
  for (const field of ["code", "secretHash", "email", "successorId", "emailEpoch"])
    expect(
      state({ pending: { ...pending, [field]: "PRIVATE_PLACEHOLDER" }, resendAvailableAt: null }),
    ).toBe(false);
  expect(state({ pending, resendAvailableAt: null, successorId: successor.id })).toBe(false);
  expect(
    state({ pending: { ...pending, successor: { id: successor.id } }, resendAvailableAt: null }),
  ).toBe(false);
  expect(state({ pending })).toBe(false);
  expect(state({ pending, resendAvailableAt: "2026-10-26 12:01" })).toBe(false);
  // The shared email-flow Challenge shape is unchanged.
  expect(valid("Challenge")({ id, expiresAt: "2026-10-26T12:10:00.000Z", state: "pending" })).toBe(
    true,
  );
  expect(
    valid("Challenge")({
      id,
      expiresAt: "2026-10-26T12:10:00.000Z",
      state: "pending",
      attemptsRemaining: 5,
    }),
  ).toBe(false);
});
test("direct membership input accepts only Trainee/Driver with a bounded reason", () => {
  const input = valid("MembershipInput");
  for (const membership of ["trainee", "driver"])
    expect(input({ membership, reason: "Fictional membership change" })).toBe(true);
  for (const membership of ["director", "dispatcher", "deputy_director", "", null])
    expect(input({ membership, reason: "Fictional membership change" })).toBe(false);
  expect(input({ membership: "driver" })).toBe(false);
  expect(input({ membership: "driver", reason: "" })).toBe(false);
  expect(input({ membership: "driver", reason: "x".repeat(2049) })).toBe(false);
  expect(input({ reason: "Fictional membership change" })).toBe(false);
  for (const extra of [{ roles: ["driver"] }, { qualifications: [] }, { director: true }])
    expect(input({ membership: "driver", reason: "Fictional", ...extra })).toBe(false);
});
test("member administration rows require a nullable millisecond UTC last accepted trip", () => {
  const id = "06400000-0000-4000-8000-000000000001",
    row = {
      profile: {
        member: { id, nickname: "Fictional Driver", formerMember: false, roles: ["driver"] },
        qualifications: [],
      },
      email: "fictional-driver@example.invalid",
      status: "active",
      accessEpoch: 1,
      identityEpoch: 1,
      version: 1,
    },
    member = valid("MemberAdmin");
  expect(member(row)).toBe(false);
  expect(member({ ...row, lastAcceptedTripAt: null })).toBe(true);
  expect(member({ ...row, lastAcceptedTripAt: "2026-10-20T18:30:00.000Z" })).toBe(true);
  for (const lastAcceptedTripAt of [
    "2026-10-20T18:30:00Z",
    "2026-10-20T18:30:00.000+03:00",
    "2026-10-20 18:30:00.000",
    "2026-10-20",
    "",
    0,
  ])
    expect(member({ ...row, lastAcceptedTripAt })).toBe(false);
  expect(
    valid("ListMemberAdmin")({ items: [{ ...row, lastAcceptedTripAt: null }], nextCursor: null }),
  ).toBe(true);
});

const dashboardContract = (file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${file}`, import.meta.url), "utf8"),
  );
const stageFixtures = dashboardContract("examples.json");
const stageFixture = (id: string) =>
  stageFixtures.cases.find((item: { id: string }) => item.id === id);

test("workspace summary exposes bounded typed previews and distinguishes omitted from zero", () => {
  const spec = dashboardContract("openapi.json");
  const operation = spec.paths["/api/v1/me/workspace-summary"].get;
  expect(spec.components.schemas.WorkspaceSummary.properties.reviewQueue.description).toContain(
    "Awaiting decision predicate (scope=review&hold=true)",
  );
  expect(operation).toMatchObject({
    operationId: "getMyWorkspaceSummary",
    security: [{ sessionCookie: [] }],
    "x-capability": "company.read",
    "x-contract-stage": "VTC-123 Step 1",
    responses: { 200: { headers: { "Cache-Control": { schema: { const: "no-store" } } } } },
  });

  const summary = valid("WorkspaceSummary");
  const visible = stageFixture("getMyWorkspaceSummary:mixed-capabilities").response.data;
  const empty = stageFixture("getMyWorkspaceSummary:authorized-empty").response.data;
  const limited = stageFixture("getMyWorkspaceSummary:limited-capabilities").response.data;
  for (const name of [
    "mixed-capabilities",
    "after-resubmission",
    "authorized-empty",
    "limited-capabilities",
  ]) {
    const fixture = stageFixture(`getMyWorkspaceSummary:${name}`);
    expect(fixture.responseHeaders).toEqual({ "Cache-Control": "no-store" });
    expect(valid("EnvelopeWorkspaceSummary")(fixture.response)).toBe(true);
  }
  expect(limited).toEqual({
    computedAt: empty.computedAt,
    tripsNeedingFixes: { count: 0, items: [] },
    reviewQueue: { count: 0, oldestAgeSeconds: null },
  });
  const after = stageFixture("getMyWorkspaceSummary:after-resubmission").response.data;
  expect(visible.tripsNeedingFixes.count).toBe(2);
  expect(visible.tripsNeedingFixes.items[0].latestReturnReason).toBe(
    "Please attach a clear delivery screenshot.",
  );
  expect(after.tripsNeedingFixes).toEqual({
    count: 1,
    items: [visible.tripsNeedingFixes.items[1]],
  });
  expect(empty).toMatchObject({
    tripsNeedingFixes: { count: 0, items: [] },
    unfinishedManualDrafts: { count: 0, items: [] },
    unansweredUpcomingEvents: { count: 0, items: [] },
    reviewQueue: { count: 0, oldestAgeSeconds: null },
    newApplicationsCount: 0,
  });
  const trip = visible.tripsNeedingFixes.items[0];
  const draft = visible.unfinishedManualDrafts.items[0];
  const event = visible.unansweredUpcomingEvents.items[0];
  expect(visible.tripsNeedingFixes.items[1].latestReturnReason).toBeNull();
  for (const extra of [
    { promotionCount: 1 },
    { reviewQueue: { ...visible.reviewQueue, oldestAgeSeconds: -1 } },
    { tripsNeedingFixes: { count: 6, items: Array(6).fill(trip) } },
    { tripsNeedingFixes: { count: 1, items: [{ ...trip, reviewerId: trip.tripId }] } },
    { unfinishedManualDrafts: { count: 1, items: [{ ...draft, updatedAt: "yesterday" }] } },
    { unansweredUpcomingEvents: { count: 1, items: [{ ...event, declineReason: "private" }] } },
    { newApplicationsCount: 1.5 },
  ]) {
    expect(summary({ ...visible, ...extra })).toBe(false);
  }
});

test("administration counters are optional and invitation counts require a separate projection", () => {
  const spec = dashboardContract("openapi.json");
  const responseSchema = (path: string) =>
    spec.paths[path].get.responses[200].content["application/json"].schema.$ref;
  expect(responseSchema("/api/v1/admin/applications")).toBe(
    "#/components/schemas/EnvelopeListAdminApplication",
  );
  expect(responseSchema("/api/v1/admin/applications/{applicationId}/history")).toBe(
    "#/components/schemas/EnvelopeListApplication",
  );
  expect(responseSchema("/api/v1/admin/members")).toBe(
    "#/components/schemas/EnvelopeListMemberAdmin",
  );

  const app = stageFixture("listApplications:status-counts");
  expect(app.query).toEqual({ status: "rejected", limit: 5 });
  expect(app.response.data.statusCounts).toEqual({ submitted: 2, approved: 3, rejected: 0 });
  expect(valid("EnvelopeListAdminApplication")(app.response)).toBe(true);
  expect(valid("EnvelopeListApplication")(app.response)).toBe(false);
  expect(
    valid("EnvelopeListAdminApplication")(stageFixture("listApplications:empty").response),
  ).toBe(true);
  expect(valid("AdminApplicationStatusCounts")({ submitted: 0, approved: 0, rejected: -1 })).toBe(
    false,
  );

  const members = stageFixture("listAdminMembers:status-counts");
  expect(members.query).toEqual({ status: "active", limit: 1 });
  expect(members.response.data.statusCounts).toEqual({
    inCompany: 8,
    left: 2,
    invited: 1,
    droveLast30Days: 3,
  });
  expect(valid("EnvelopeListMemberAdmin")(members.response)).toBe(true);
  const restricted = stageFixture("listAdminMembers:admissions-disabled").response;
  const noActivity = stageFixture("listAdminMembers:trips-disabled");
  expect(noActivity.query).toEqual({ status: "inactive" });
  expect(noActivity.response.data.statusCounts).toEqual({ inCompany: 8, left: 0, invited: 1 });
  expect(valid("EnvelopeListMemberAdmin")(noActivity.response)).toBe(true);
  expect(valid("AdminMemberStatusCounts")({ inCompany: 0, left: 0 })).toBe(true);
  const combined = stageFixture("listAdminMembers:inactive-driver-nickname");
  expect(combined.query).toEqual({
    status: "inactive",
    role: "driver",
    search: "  Fictional Alex  ",
  });
  expect(combined.response.data).toEqual({
    items: [],
    nextCursor: null,
    statusCounts: { inCompany: 1, left: 0, invited: 0, droveLast30Days: 0 },
  });
  expect(valid("EnvelopeListMemberAdmin")(combined.response)).toBe(true);
  expect(restricted.data.statusCounts).toEqual({ inCompany: 0, left: 0, droveLast30Days: 0 });
  expect(valid("EnvelopeListMemberAdmin")(restricted)).toBe(true);
  expect(valid("EnvelopeListMemberAdmin")(stageFixture("listAdminMembers:empty").response)).toBe(
    true,
  );
  expect(
    valid("AdminMemberStatusCounts")({ ...restricted.data.statusCounts, inviteEmail: "private" }),
  ).toBe(false);
});

test("Stage 3 audit validates action- and object-specific closed snapshots", () => {
  const checkEntry = valid("AuditStage3Entry");
  const id = "e1390000-0000-4000-8000-000000000001";
  const entry = {
    id,
    actorId: id,
    actorNickname: null,
    subjectId: id,
    objectName: null,
    occurredAt: "2026-01-05T12:00:00.125Z",
    action: "roles.changed",
    objectType: "user",
  };
  const after = { roles: ["dispatcher"] };
  expect(checkEntry({ ...entry, details: null })).toBe(true);
  expect(checkEntry({ ...entry, details: { before: null, after } })).toBe(true);
  expect(checkEntry({ ...entry, objectType: "trip", details: { before: null, after } })).toBe(
    false,
  );
  expect(
    checkEntry({ ...entry, action: "report.reviewed", details: { before: null, after } }),
  ).toBe(false);
  expect(checkEntry({ ...entry, details: { before: null, after: null } })).toBe(false);
  expect(
    checkEntry({
      ...entry,
      details: { before: null, after: { ...after, reason: "Fictional private reason" } },
    }),
  ).toBe(false);
  expect(
    checkEntry({
      ...entry,
      details: { before: null, after: { roles: ["dispatcher", "dispatcher"] } },
    }),
  ).toBe(false);
  expect(checkEntry({ ...entry, details: { before: null, after: { roles: ["invented"] } } })).toBe(
    false,
  );
});

const stage4Spec = dashboardContract("openapi.json") as {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, { properties?: object; required?: string[] }> };
};
const stage4Operations = Object.values(stage4Spec.paths).flatMap((methods) =>
  Object.values(methods),
) as {
  operationId: string;
  parameters?: { name?: string; $ref?: string }[];
  "x-contract-stage"?: string;
  "x-owner-card"?: string;
  "x-capability"?: string;
  "x-stage-4-changes"?: {
    "x-owner-card": string;
    parameters: string[];
    fields: string[];
    description: string;
  };
}[];

test("Stage 4 additions are optional, owned and confined to their named operations", () => {
  const changed = stage4Operations.filter((item) => item["x-stage-4-changes"]);
  expect(changed.map((item) => item.operationId).sort()).toEqual([
    "getApplication",
    "getCompanyAnalytics",
    "getLeaderboard",
    "getMe",
    "getMember",
    "getNotificationPreferences",
    "getTrip",
    "listMembers",
    "listNotificationHistory",
    "login",
    "pollNotifications",
    "setNotificationPreferences",
    "submitApplication",
    "updatePreferences",
  ]);
  for (const item of changed) {
    const changes = item["x-stage-4-changes"];
    if (!changes) throw new Error("UNREACHABLE");
    expect(["VTC-140", "VTC-141", "VTC-142", "VTC-143", "VTC-144"]).toContain(
      changes["x-owner-card"],
    );
    expect(changes.description.length).toBeGreaterThan(0);
    const names = new Set((item.parameters ?? []).map((parameter) => parameter.name));
    for (const parameter of changes.parameters) expect(names.has(parameter), parameter).toBe(true);
    for (const field of changes.fields) {
      const [schema = "", property = ""] = field.split(".");
      const target = stage4Spec.components.schemas[schema];
      expect(target?.properties, field).toHaveProperty(property);
      // Existing callers keep validating; once activated a lane always returns the field.
      if (schema !== "Notification" && !schema.endsWith("Stage4"))
        expect(target?.required ?? [], field).not.toContain(property);
    }
  }
  const staged = stage4Operations.filter((item) => item["x-contract-stage"] === "VTC-150 Step 1");
  expect(
    staged.map((item) => [item.operationId, item["x-owner-card"], item["x-capability"]]).sort(),
  ).toEqual([
    ["getCompanyAnalyticsBreakdown", "VTC-112", "company.read"],
    ["listInvitations", "VTC-140", "applications.manage"],
    ["recheckApplicationTruckersmp", "VTC-144", "applications.manage"],
  ]);
  // Decision: no combined roles and membership command; setRoles stays the atomic role save.
  expect(
    Object.keys(stage4Spec.paths).filter((path) => /roles.*membership|access-change/.test(path)),
  ).toEqual([]);
  // listQualificationMembers keeps the unchanged ListMemberSummary shape.
  expect(stage4Spec.components.schemas.ListMemberSummary?.properties).not.toHaveProperty(
    "windowEndsAt",
  );
});

test("the member directory returns 30-day totals with zero rows and a bounded window", () => {
  const list = valid("MemberStage4DirectoryList");
  const sorted = stageFixture("listMembers:stage-4-sorted-filtered").response.data;
  expect(list(sorted)).toBe(true);
  expect(list(stageFixture("listMembers:stage-4-empty-level-filter").response.data)).toBe(true);
  const [active, quiet] = sorted.items;
  expect(quiet.last30Days).toEqual({ acceptedTrips: 0, actualDistanceM: "0" });
  expect(quiet.lastAcceptedTripAt).toBeNull();
  expect(valid("ListMemberSummary")(sorted)).toBe(false);
  const { last30Days: _totals, lastAcceptedTripAt: _last, ...summary } = active;
  expect(valid("MemberSummary")(summary)).toBe(true);
  expect(list({ items: [summary], nextCursor: null })).toBe(true);
  for (const row of [
    { ...active, email: "member@example.invalid" },
    { ...active, last30Days: { acceptedTrips: -1, actualDistanceM: "0" } },
    { ...active, last30Days: { acceptedTrips: 1 } },
    { ...active, last30Days: { acceptedTrips: 1, actualDistanceM: "-1" } },
    { ...active, lastAcceptedTripAt: "2026-11-10" },
  ])
    expect(list({ ...sorted, items: [row] }), JSON.stringify(row)).toBe(false);
  expect(list({ ...sorted, windowEndsAt: "2026-11-14" })).toBe(false);
  const listMembers = stage4Operations.find((item) => item.operationId === "listMembers");
  const parameters = (listMembers?.parameters ?? []).map(
    (parameter) => parameter.name ?? parameter.$ref,
  );
  expect(parameters).toEqual([
    "#/components/parameters/Limit",
    "#/components/parameters/Cursor",
    "search",
    "role",
    "status",
    "ets2Level",
    "atsLevel",
    "sort",
    "order",
  ]);
});

test("the member directory adds a status filter, company-wide counts and current levels", () => {
  const list = valid("MemberStage4DirectoryList");
  const activeTab = stageFixture("listMembers:stage-4-active-tab").response.data;
  const formerTab = stageFixture("listMembers:stage-4-former-tab").response.data;
  const withoutTrips = stageFixture("listMembers:stage-4-without-trips").response.data;
  for (const data of [activeTab, formerTab, withoutTrips]) expect(list(data)).toBe(true);
  const [driver, trainee] = activeTab.items;
  // A zero-activity row and a row with one game unassigned.
  expect(trainee.last30Days).toEqual({ acceptedTrips: 0, actualDistanceM: "0" });
  expect(trainee.lastAcceptedTripAt).toBeNull();
  expect(trainee.levels.ats).toBeNull();
  expect(activeTab.statusCounts).toEqual({ active: 18, former: 4, droveLast30Days: 1 });
  const [former] = formerTab.items;
  expect(former).toMatchObject({ formerMember: true, roles: [] });
  expect(former.levels).toEqual({ ets2: null, ats: null });
  expect(former.last30Days).toBeDefined();
  expect(Object.keys(withoutTrips).sort()).toEqual(["items", "nextCursor", "statusCounts"]);
  expect(Object.keys(withoutTrips.statusCounts).sort()).toEqual(["active", "former"]);
  for (const item of withoutTrips.items) {
    expect(item).not.toHaveProperty("last30Days");
    expect(item).not.toHaveProperty("lastAcceptedTripAt");
  }
  // Existing callers without levels or counts keep validating.
  const { levels: _levels, ...withoutLevels } = driver;
  const { statusCounts: _counts, ...withoutCounts } = activeTab;
  expect(list({ ...withoutCounts, items: [withoutLevels] })).toBe(true);

  const level = driver.levels.ets2;
  const { position: _position, ...withoutPosition } = level;
  for (const levels of [
    { ets2: level },
    { ets2: withoutPosition, ats: null },
    { ets2: { ...level, position: 0 }, ats: null },
    { ets2: { ...level, position: 26 }, ats: null },
    { ets2: { ...level, position: 1.5 }, ats: null },
    { ets2: { ...level, terminal: true }, ats: null },
    { ets2: { ...level, id: "not-a-level" }, ats: null },
    { ets2: { ...level, name: "" }, ats: null },
    { ets2: null, ats: null, inCompany: true },
  ])
    expect(list({ ...activeTab, items: [{ ...driver, levels }] }), JSON.stringify(levels)).toBe(
      false,
    );
  expect(list({ ...activeTab, items: [{ ...driver, levels: null }] })).toBe(false);
  for (const statusCounts of [
    { active: 18 },
    { former: 4 },
    { active: -1, former: 4 },
    { active: 18, former: 4, droveLast30Days: -1 },
    { active: 18, former: 4, droveLast30Days: "11" },
    { active: 1.5, former: 4 },
    { active: 18, former: 4, inCompany: 22 },
  ])
    expect(list({ ...activeTab, statusCounts }), JSON.stringify(statusCounts)).toBe(false);

  const listMembers = stage4Operations.find((item) => item.operationId === "listMembers") as {
    parameters: { name?: string; schema?: { type?: string; enum?: string[] } }[];
    "x-stage-4-changes": { parameters: string[]; fields: string[] };
  };
  const status = listMembers.parameters.find((parameter) => parameter.name === "status");
  expect(status?.schema).toEqual({ type: "string", enum: ["active", "former"] });
  expect(listMembers["x-stage-4-changes"].parameters).toContain("status");
  expect(listMembers["x-stage-4-changes"].fields).toEqual(
    expect.arrayContaining([
      "MemberStage4DirectoryList.statusCounts",
      "MemberStage4DirectoryEntry.levels",
    ]),
  );
  // Both additions stay optional for existing callers.
  const schemas = stage4Spec.components.schemas;
  expect(schemas.MemberStage4DirectoryList?.required).toEqual(["items", "nextCursor"]);
  expect(schemas.MemberStage4DirectoryEntry?.required).not.toContain("levels");
  expect(schemas.MemberStage4DirectoryCounts?.required).toEqual(["active", "former"]);
});

test("member profiles add the latest join and last accepted trip", () => {
  const profile = valid("MemberProfile");
  expect(profile(stageFixture("getMember:stage-4-returned-member").response.data)).toBe(true);
  const quiet = stageFixture("getMember:stage-4-no-accepted-trip").response.data;
  expect(profile(quiet)).toBe(true);
  expect(profile({ ...quiet, memberSince: null })).toBe(false);
  expect(profile({ ...quiet, firstJoinedAt: quiet.memberSince })).toBe(false);
  const { memberSince: _since, lastAcceptedTripAt: _last, ...legacy } = quiet;
  expect(profile(legacy)).toBe(true);
});

test("member profiles add the directory's optional 30-day totals and window end", () => {
  const profile = valid("MemberProfile");
  const returned = stageFixture("getMember:stage-4-returned-member").response.data;
  const quiet = stageFixture("getMember:stage-4-no-accepted-trip").response.data;
  expect(returned.last30Days).toEqual({ acceptedTrips: 12, actualDistanceM: "3600000" });
  // A computed zero, not an absent value.
  expect(quiet.last30Days).toEqual({ acceptedTrips: 0, actualDistanceM: "0" });
  // The window end is the directory's windowEndsAt for the same instant.
  expect(quiet.last30DaysEndsAt).toBe(
    stageFixture("listMembers:stage-4-sorted-filtered").response.data.windowEndsAt,
  );
  // Existing callers without the totals (Trips off) keep validating.
  const { last30Days: _totals, last30DaysEndsAt: _end, ...withoutTotals } = returned;
  expect(profile(withoutTotals)).toBe(true);
  for (const data of [
    { ...returned, last30Days: { acceptedTrips: -1, actualDistanceM: "0" } },
    { ...returned, last30Days: { acceptedTrips: 1.5, actualDistanceM: "0" } },
    { ...returned, last30Days: { acceptedTrips: 1 } },
    { ...returned, last30Days: { acceptedTrips: 1, actualDistanceM: "-1" } },
    { ...returned, last30Days: { ...returned.last30Days, month: 1 } },
    { ...returned, last30Days: null },
    { ...returned, last30DaysEndsAt: "2026-11-14" },
    { ...returned, last30DaysEndsAt: null },
    { ...returned, last30DaysStartsAt: "2026-10-15T12:00:00.000Z" },
  ])
    expect(profile(data), JSON.stringify(data)).toBe(false);
  const schemas = stage4Spec.components.schemas;
  expect(schemas.MemberProfile?.required).toEqual(["member", "qualifications"]);
});

test("the invitation list exposes current generations without any link secret", () => {
  const list = valid("InvitationStage4List");
  const active = stageFixture("listInvitations:stage-4-active").response.data;
  expect(list(active)).toBe(true);
  expect(list(stageFixture("listInvitations:stage-4-expired-empty").response.data)).toBe(true);
  const [item] = active.items;
  for (const field of ["link", "token", "secretHash", "ciphertext", "url"]) {
    expect(list({ ...active, items: [{ ...item, [field]: "PRIVATE_PLACEHOLDER" }] }), field).toBe(
      false,
    );
    expect(
      list({
        ...active,
        items: [{ ...item, invitation: { ...item.invitation, [field]: "PRIVATE_PLACEHOLDER" } }],
      }),
      field,
    ).toBe(false);
  }
  expect(
    list({ ...active, items: [{ ...item, applicant: { ...item.applicant, steamId: "1" } }] }),
  ).toBe(false);
  const { total: _total, ...withoutTotal } = active;
  expect(list(withoutTotal)).toBe(false);
  expect(list({ ...active, total: -1 })).toBe(false);
});

test("login and getMe return the same Stage 4 self envelope with a nullable zone", () => {
  const responses = stage4Operations as unknown as {
    operationId: string;
    responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }>;
  }[];
  for (const id of ["getMe", "login"]) {
    const item = responses.find((entry) => entry.operationId === id);
    expect(item?.responses["200"]?.content?.["application/json"]?.schema.$ref, id).toBe(
      "#/components/schemas/SelfStage4Envelope",
    );
  }
  const envelope = valid("SelfStage4Envelope");
  for (const id of ["getMe:stage-4-device-timezone", "login:stage-4-device-timezone"]) {
    const fixture = stageFixture(id).response;
    expect(envelope(fixture), id).toBe(true);
    expect((fixture.data as { preferences: { displayTimezone: null } }).preferences, id).toEqual({
      locale: "ru",
      displayTimezone: null,
    });
    expect(valid("EnvelopeSelf")(fixture), id).toBe(false);
  }
});
