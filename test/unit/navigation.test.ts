import { expect, test } from "vitest";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import {
  canReport,
  loginDestination,
  matchRouteMeta,
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
  ])
    keys.add(`nav.${key}`);
  for (const key of keys)
    for (const locale of [core.en, core.ru]) expect(typeof lookup(locale, key), key).toBe("string");
  expect(Object.keys(core.ru.nav.items)).toEqual(Object.keys(core.en.nav.items));
});
