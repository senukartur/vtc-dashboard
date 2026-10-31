import { expect, test } from "vitest";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import {
  accountLinks,
  bottomBarItems,
  canReport,
  currentMarker,
  loginDestination,
  matchRouteMeta,
  moreGroups,
  navGroups,
  navItem,
  paths,
  primaryRole,
  type RouteId,
  routeMeta,
  visibleGroups,
} from "../../apps/web/src/app/navigation-model.ts";
import { core } from "../../apps/web/src/i18n/core/resources.ts";

const shape = (roles: Role[]) =>
  Object.fromEntries(
    visibleGroups(capabilities(roles)).map((group) => [
      group.id,
      group.items.map((item) => item.id),
    ]),
  );

test("sidebar groups follow the server capability mapping for every role combination", () => {
  const member = {
    personal: ["overview", "myTrips", "drafts"],
    company: ["events", "drivers", "qualifications"],
  };
  expect(shape(["trainee"])).toEqual(member);
  expect(shape(["driver"])).toEqual(shape(["trainee"]));
  expect(shape(["dispatcher"])).toEqual({
    personal: ["overview", "myTrips"],
    company: member.company,
    review: ["dispatch", "reconciliation"],
  });
  expect(shape(["driver", "dispatcher"])).toEqual({
    ...member,
    review: ["dispatch", "reconciliation"],
  });
  const leadership = {
    personal: ["overview", "myTrips"],
    company: member.company,
    review: ["dispatch", "reconciliation"],
    management: ["applications", "members", "catalogs", "settings"],
  };
  expect(shape(["deputy_director"])).toEqual(leadership);
  expect(shape(["director"])).toEqual(leadership);
  for (const [roles, report] of [
    [["trainee"], true],
    [["driver"], true],
    [["dispatcher"], false],
    [["driver", "dispatcher"], true],
    [["deputy_director"], false],
    [["director"], false],
  ] as const)
    expect(canReport(capabilities([...roles]))).toBe(report);
});

test("empty or unknown capabilities show no groups and personal pages stay out of the main list", () => {
  expect(visibleGroups([])).toEqual([]);
  expect(visibleGroups(["unknown.capability", "leadership.transfer"])).toEqual([]);
  expect(canReport([])).toBe(false);
  const routes = navGroups.flatMap((group) => group.items.map((item) => item.route));
  for (const personal of ["account", "connections", "notifications"] as const)
    expect(routes).not.toContain(personal);
  expect(new Set(routes).size).toBe(routes.length);
});

test("every workspace route has metadata and resolves through router ranking", () => {
  for (const id of Object.keys(paths) as RouteId[]) expect(routeMeta[id]).toBeDefined();
  for (const item of navGroups.flatMap((group) => group.items)) {
    expect(matchRouteMeta(paths[item.route])).toMatchObject({ id: item.route, item: item.id });
    expect(navItem(item.id)).toBe(item);
  }
  expect(matchRouteMeta("/account/drivers/41000000-0000-4000-8000-000000000017")).toEqual({
    id: "driver",
    group: "company",
    item: "drivers",
    titleKey: "nav.details.driverProfile",
  });
  expect(matchRouteMeta("/account/review/reconciliation")).toMatchObject({
    id: "reconciliation",
    item: "reconciliation",
  });
  expect(matchRouteMeta("/account/review/41000000-0000-4000-8000-000000000017")).toMatchObject({
    id: "reviewTrip",
    item: "dispatch",
    titleKey: "nav.details.tripReview",
  });
  expect(matchRouteMeta("/account/reports/new")).toMatchObject({ id: "newReport", item: "drafts" });
  expect(matchRouteMeta("/account/events/new")).toMatchObject({ id: "newEvent", item: "events" });
  expect(matchRouteMeta("/ACCOUNT/Trips")).toMatchObject({ id: "trips", item: "myTrips" });
  expect(matchRouteMeta("/account/trips/")).toMatchObject({ id: "trips" });
  expect(matchRouteMeta("/account")).toEqual({
    id: "account",
    group: "account",
    titleKey: "nav.account.security",
  });
  for (const unknown of ["/", "/accounting", "/account/unknown", "/foundation/member"])
    expect(matchRouteMeta(unknown)).toBeNull();
});

test("sign-in returns only to same-app workspace locations", () => {
  for (const state of [
    undefined,
    null,
    "/account/trips",
    { from: "/account/trips" },
    { from: { pathname: "/login" } },
    { from: { pathname: "//evil.example" } },
    { from: { pathname: "/\\evil.example" } },
    { from: { pathname: "https://evil.example/account" } },
    { from: { pathname: "/accounting" } },
    { from: { pathname: "/account//evil.example" } },
    { from: { pathname: "/account/../login" } },
    { from: { pathname: "/account/./trips" } },
    { from: { pathname: "/account/.." } },
    { from: { pathname: "/account/trips", search: "x=1" } },
    { from: { pathname: "/account/trips", hash: "x" } },
    { from: { pathname: "/account/trips", search: 1 } },
    { from: { pathname: 42 } },
  ])
    expect(loginDestination(state)).toBe("/account/dashboard");
  expect(
    loginDestination({
      from: { pathname: "/account/trips", search: "?scope=company", hash: "#x" },
    }),
  ).toBe("/account/trips?scope=company#x");
  expect(loginDestination({ from: { pathname: "/account" } })).toBe("/account");
});

test("primary role follows leadership precedence", () => {
  expect(primaryRole(["trainee", "director", "driver"])).toBe("director");
  expect(primaryRole(["driver", "deputy_director"])).toBe("deputy_director");
  expect(primaryRole(["driver", "dispatcher"])).toBe("dispatcher");
  expect(primaryRole(["trainee", "driver"])).toBe("driver");
  expect(primaryRole(["trainee"])).toBe("trainee");
  expect(primaryRole([])).toBeNull();
  expect(primaryRole(["unknown"])).toBeNull();
});

test("every navigation label used by the model exists in Russian and English", () => {
  const lookup = (tree: unknown, key: string) =>
    key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
  const keys = new Set<string>([
    ...navGroups.map((group) => `nav.groups.${group.id}`),
    "nav.groups.account",
    ...navGroups.flatMap((group) => group.items.map((item) => `nav.items.${item.id}`)),
    ...Object.values(routeMeta).map((meta) => meta.titleKey),
  ]);
  for (const key of [
    "primary",
    "workspace",
    "workspaceLink",
    "breadcrumb",
    "newReport",
    "collapse",
    "expand",
    "userMenu",
    "myProfile",
    "publicSite",
    "sections",
    "more",
    "moreDescription",
  ])
    keys.add(`nav.${key}`);
  for (const roles of everyRole)
    for (const entry of bottomBarItems(capabilities(roles))) {
      keys.add(entry.labelKey);
      if (entry.nameKey) keys.add(entry.nameKey);
    }
  for (const entry of accountLinks({ capabilities: ["company.read"], memberId: "x" }))
    keys.add(entry.labelKey);
  for (const key of keys)
    for (const locale of [core.en, core.ru]) expect(typeof lookup(locale, key), key).toBe("string");
  expect(Object.keys(core.ru.nav.items)).toEqual(Object.keys(core.en.nav.items));
  expect(Object.keys(core.ru.nav.bar)).toEqual(Object.keys(core.en.nav.bar));
});

const everyRole: Role[][] = [
  [],
  ["trainee"],
  ["driver"],
  ["dispatcher"],
  ["driver", "dispatcher"],
  ["deputy_director"],
  ["director"],
];
const bar = (roles: Role[]) => bottomBarItems(capabilities(roles)).map((entry) => entry.id);
const more = (roles: Role[]) =>
  Object.fromEntries(
    moreGroups(capabilities(roles)).map((group) => [group.id, group.items.map((item) => item.id)]),
  );

test("phone bottom bar keeps four sections with a role-dependent third slot", () => {
  const reporter = ["overview", "myTrips", "newReport", "events"];
  const reviewer = ["overview", "myTrips", "dispatch", "events"];
  expect(bar(["trainee"])).toEqual(reporter);
  expect(bar(["driver"])).toEqual(reporter);
  expect(bar(["driver", "dispatcher"])).toEqual(reporter);
  expect(bar(["dispatcher"])).toEqual(reviewer);
  expect(bar(["deputy_director"])).toEqual(reviewer);
  expect(bar(["director"])).toEqual(reviewer);
  // Role-less members keep company.read only: the bar shrinks to three sections plus More.
  expect(bar([])).toEqual(["overview", "myTrips", "events"]);
  expect(bottomBarItems([])).toEqual([]);
  expect(bottomBarItems(["unknown.capability"])).toEqual([]);
  const items = bottomBarItems(capabilities(["trainee"]));
  expect(items.find((entry) => entry.id === "newReport")).toMatchObject({
    route: "newReport",
    accent: true,
    nameKey: "nav.newReport",
  });
  expect(items.filter((entry) => entry.accent).map((entry) => entry.id)).toEqual(["newReport"]);
  expect(bottomBarItems(capabilities(["dispatcher"])).find((e) => e.id === "dispatch")).toEqual({
    id: "dispatch",
    route: "review",
    labelKey: "nav.bar.dispatch",
  });
});

test("More sheet groups hold exactly the visible sections that the bar leaves out", () => {
  const company = ["drivers", "qualifications"];
  expect(more(["trainee"])).toEqual({ personal: ["drafts"], company });
  expect(more(["driver"])).toEqual(more(["trainee"]));
  expect(more(["dispatcher"])).toEqual({ company, review: ["reconciliation"] });
  expect(more(["driver", "dispatcher"])).toEqual({
    personal: ["drafts"],
    company,
    review: ["dispatch", "reconciliation"],
  });
  const leadership = {
    company,
    review: ["reconciliation"],
    management: ["applications", "members", "catalogs", "settings"],
  };
  expect(more(["deputy_director"])).toEqual(leadership);
  expect(more(["director"])).toEqual(leadership);
  expect(more([])).toEqual({ company });
  for (const roles of everyRole) {
    const inBar = bar(roles).filter((id) => id !== "newReport");
    const inSheet = moreGroups(capabilities(roles)).flatMap((g) => g.items.map((i) => i.id));
    const visible = visibleGroups(capabilities(roles)).flatMap((g) => g.items.map((i) => i.id));
    expect(
      inSheet.filter((id) => (inBar as string[]).includes(id)),
      roles.join("+"),
    ).toEqual([]);
    expect(new Set([...inBar, ...inSheet]), roles.join("+")).toEqual(new Set(visible));
  }
});

test("current markers distinguish a section page from its detail routes", () => {
  const marker = (entry: Parameters<typeof currentMarker>[0], pathname: string) =>
    currentMarker(entry, matchRouteMeta(pathname));
  const report = { id: "newReport", route: "newReport" } as const;
  const dispatch = { id: "dispatch", route: "review" } as const;
  const events = { id: "events", route: "events" } as const;
  const drafts = navItem("drafts") ?? report;
  const uuid = "41000000-0000-4000-8000-000000000017";
  expect(marker(report, "/account/reports/new")).toBe("page");
  expect(marker(report, `/account/reports/drafts/${uuid}`)).toBeUndefined();
  expect(marker(report, "/account/reports")).toBeUndefined();
  expect(marker(drafts, "/account/reports/new")).toBe("true");
  expect(marker(dispatch, "/account/review")).toBe("page");
  expect(marker(dispatch, `/account/review/${uuid}`)).toBe("true");
  expect(marker(dispatch, "/account/review/reconciliation")).toBeUndefined();
  expect(marker(events, `/account/events/${uuid}`)).toBe("true");
  expect(marker(events, "/account/events/new")).toBe("true");
  expect(marker(events, "/account/events")).toBe("page");
  expect(marker(events, "/account")).toBeUndefined();
  expect(marker(events, "/")).toBeUndefined();
});

test("account links are shared by the user menu and the More sheet", () => {
  const memberId = "41000000-0000-4000-8000-000000000017";
  expect(accountLinks({ capabilities: capabilities(["trainee"]), memberId })).toEqual([
    { id: "profile", to: `/account/drivers/${memberId}`, labelKey: "nav.myProfile" },
    { id: "security", to: "/account", labelKey: "nav.account.security" },
    { id: "connections", to: "/account/connections", labelKey: "nav.account.connections" },
  ]);
  expect(accountLinks({ capabilities: [], memberId })).toEqual([
    { id: "security", to: "/account", labelKey: "nav.account.security" },
  ]);
  expect(accountLinks({ capabilities: ["company.read"], memberId: "a/b" })[0]?.to).toBe(
    "/account/drivers/a%2Fb",
  );
});

test("bar accessible names contain their visible labels in Russian and English", () => {
  const lookup = (tree: unknown, key: string) =>
    String(
      key
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          tree,
        ),
    );
  const entries = new Map(
    everyRole.flatMap((roles) => bottomBarItems(capabilities(roles))).map((e) => [e.id, e]),
  );
  expect([...entries.keys()].sort()).toEqual(
    ["dispatch", "events", "myTrips", "newReport", "overview"].sort(),
  );
  for (const locale of [core.en, core.ru])
    for (const entry of entries.values()) {
      const label = lookup(locale, entry.labelKey);
      const name = lookup(locale, entry.nameKey ?? entry.labelKey);
      expect(name.toLocaleLowerCase(), entry.id).toContain(label.toLocaleLowerCase());
    }
  expect(core.en.nav.bar).toEqual({
    overview: "Overview",
    myTrips: "Trips",
    newReport: "Report",
    events: "Events",
    dispatch: "Review",
  });
  expect(core.ru.nav.bar).toEqual({
    overview: "Обзор",
    myTrips: "Рейсы",
    newReport: "Отчёт",
    events: "События",
    dispatch: "Проверка",
  });
});
