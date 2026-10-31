import { matchRoutes } from "react-router-dom";

/** Every authenticated workspace route. App.tsx renders exactly these patterns. */
export const paths = {
  account: "/account",
  connections: "/account/connections",
  notifications: "/account/notifications",
  dashboard: "/account/dashboard",
  trips: "/account/trips",
  trip: "/account/trips/:tripId",
  reports: "/account/reports",
  newReport: "/account/reports/new",
  draft: "/account/reports/drafts/:draftId",
  revise: "/account/reports/:reportId/edit",
  events: "/account/events",
  newEvent: "/account/events/new",
  event: "/account/events/:eventId",
  drivers: "/account/drivers",
  driver: "/account/drivers/:memberId",
  qualifications: "/account/qualifications",
  review: "/account/review",
  reconciliation: "/account/review/reconciliation",
  reviewTrip: "/account/review/:tripId",
  applications: "/account/admin/applications",
  members: "/account/admin/members",
  catalogs: "/account/catalogs",
  settings: "/account/admin/settings",
} as const;
export type RouteId = keyof typeof paths;

export type NavGroupId = "personal" | "company" | "review" | "management";
export type NavItemId =
  | "overview"
  | "myTrips"
  | "drafts"
  | "events"
  | "drivers"
  | "qualifications"
  | "dispatch"
  | "reconciliation"
  | "applications"
  | "members"
  | "catalogs"
  | "settings";
export interface NavItem {
  id: NavItemId;
  route: RouteId;
  /** Presentation only: the server still authorizes every read and command. */
  capability: string;
}
export interface NavGroup {
  id: NavGroupId;
  items: readonly NavItem[];
}

export const navGroups: readonly NavGroup[] = [
  {
    id: "personal",
    items: [
      { id: "overview", route: "dashboard", capability: "company.read" },
      { id: "myTrips", route: "trips", capability: "company.read" },
      { id: "drafts", route: "reports", capability: "trips.submit_own" },
    ],
  },
  {
    id: "company",
    items: [
      { id: "events", route: "events", capability: "company.read" },
      { id: "drivers", route: "drivers", capability: "company.read" },
      { id: "qualifications", route: "qualifications", capability: "company.read" },
    ],
  },
  {
    id: "review",
    items: [
      { id: "dispatch", route: "review", capability: "trips.review" },
      { id: "reconciliation", route: "reconciliation", capability: "trips.review" },
    ],
  },
  {
    id: "management",
    items: [
      { id: "applications", route: "applications", capability: "applications.manage" },
      { id: "members", route: "members", capability: "members.manage" },
      { id: "catalogs", route: "catalogs", capability: "qualifications.manage" },
      { id: "settings", route: "settings", capability: "company.configure" },
    ],
  },
];

export interface RouteMeta {
  group: NavGroupId | "account";
  /** Sidebar item that owns this route; detail routes point at their parent list. */
  item?: NavItemId;
  titleKey: string;
}
const item = (group: NavGroupId, id: NavItemId, detail?: string): RouteMeta => ({
  group,
  item: id,
  titleKey: detail ? `nav.details.${detail}` : `nav.items.${id}`,
});
export const routeMeta: Record<RouteId, RouteMeta> = {
  account: { group: "account", titleKey: "nav.account.security" },
  connections: { group: "account", titleKey: "nav.account.connections" },
  notifications: { group: "account", titleKey: "nav.account.notifications" },
  dashboard: item("personal", "overview"),
  trips: item("personal", "myTrips"),
  trip: item("personal", "myTrips", "trip"),
  revise: item("personal", "myTrips", "revise"),
  reports: item("personal", "drafts"),
  newReport: item("personal", "drafts", "newReport"),
  draft: item("personal", "drafts", "draft"),
  events: item("company", "events"),
  newEvent: item("company", "events", "newEvent"),
  event: item("company", "events", "event"),
  drivers: item("company", "drivers"),
  driver: item("company", "drivers", "driverProfile"),
  qualifications: item("company", "qualifications"),
  review: item("review", "dispatch"),
  reconciliation: item("review", "reconciliation"),
  reviewTrip: item("review", "dispatch", "tripReview"),
  applications: item("management", "applications"),
  members: item("management", "members"),
  catalogs: item("management", "catalogs"),
  settings: item("management", "settings"),
};

const routeObjects = (Object.keys(paths) as RouteId[]).map((id) => ({ id, path: paths[id] }));
/** Matches with React Router's own ranking, so `/review/reconciliation` beats `/review/:tripId`. */
export function matchRouteMeta(pathname: string): (RouteMeta & { id: RouteId }) | null {
  const match = matchRoutes(routeObjects, pathname)?.at(-1);
  if (!match) return null;
  const id = match.route.id;
  return { id, ...routeMeta[id] };
}
export function navItem(id: NavItemId): NavItem | undefined {
  return navGroups.flatMap((group) => group.items).find((entry) => entry.id === id);
}

export function visibleGroups(capabilities: readonly string[]): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((entry) => capabilities.includes(entry.capability)),
    }))
    .filter((group) => group.items.length > 0);
}
export function canReport(capabilities: readonly string[]) {
  return capabilities.includes("trips.submit_own");
}

export type BarItemId = "overview" | "myTrips" | "newReport" | "dispatch" | "events";
export interface BarItem {
  id: BarItemId;
  route: RouteId;
  /** Short visible label. */
  labelKey: string;
  /** Fuller accessible name; it always contains the visible label (WCAG 2.5.3). */
  nameKey?: string;
  accent?: boolean;
}
const barItem = (
  id: "overview" | "myTrips" | "dispatch" | "events",
  nameKey?: string,
): BarItem => ({
  id,
  route: navItem(id)?.route ?? "dashboard",
  labelKey: `nav.bar.${id}`,
  ...(nameKey ? { nameKey } : {}),
});
/**
 * Phone bottom bar sections in order. The third slot is New report for members who submit
 * their own trips, otherwise Dispatch for reviewers, otherwise it is omitted. Presentation only.
 */
export function bottomBarItems(capabilities: readonly string[]): BarItem[] {
  const allowed = (id: NavItemId) => {
    const entry = navItem(id);
    return entry !== undefined && capabilities.includes(entry.capability);
  };
  const third: BarItem | null = canReport(capabilities)
    ? {
        id: "newReport",
        route: "newReport",
        labelKey: "nav.bar.newReport",
        nameKey: "nav.newReport",
        accent: true,
      }
    : allowed("dispatch")
      ? barItem("dispatch")
      : null;
  return [
    ...(allowed("overview") ? [barItem("overview")] : []),
    ...(allowed("myTrips") ? [barItem("myTrips", "nav.items.myTrips")] : []),
    ...(third ? [third] : []),
    ...(allowed("events") ? [barItem("events")] : []),
  ];
}
/** Groups for the phone More sheet: the visible groups without sections already in the bar. */
export function moreGroups(capabilities: readonly string[]): NavGroup[] {
  const inBar = new Set<string>(bottomBarItems(capabilities).map((entry) => entry.id));
  return visibleGroups(capabilities)
    .map((group) => ({ ...group, items: group.items.filter((entry) => !inBar.has(entry.id)) }))
    .filter((group) => group.items.length > 0);
}
/**
 * `aria-current` for a navigation entry: "page" on the entry's own route, "true" on a detail
 * route the entry owns (for example a driver profile under Drivers), otherwise none.
 */
export function currentMarker(
  entry: { id: string; route: RouteId },
  meta: (RouteMeta & { id: RouteId }) | null,
): "page" | "true" | undefined {
  if (!meta) return undefined;
  if (meta.id === entry.route) return "page";
  return meta.item === entry.id ? "true" : undefined;
}

export type AccountLinkId = "profile" | "security" | "connections";
/** Personal destinations shared by the user menu and the phone More sheet. */
export function accountLinks({
  capabilities,
  memberId,
}: {
  capabilities: readonly string[];
  memberId: string;
}): { id: AccountLinkId; to: string; labelKey: string }[] {
  const company = capabilities.includes("company.read");
  return [
    ...(company
      ? [
          {
            id: "profile" as const,
            to: `/account/drivers/${encodeURIComponent(memberId)}`,
            labelKey: "nav.myProfile",
          },
        ]
      : []),
    { id: "security" as const, to: paths.account, labelKey: "nav.account.security" },
    ...(company
      ? [{ id: "connections" as const, to: paths.connections, labelKey: "nav.account.connections" }]
      : []),
  ];
}

const rolePrecedence = ["director", "deputy_director", "dispatcher", "driver", "trainee"] as const;
export type PrimaryRole = (typeof rolePrecedence)[number];
export function primaryRole(roles: readonly string[]): PrimaryRole | null {
  return rolePrecedence.find((role) => roles.includes(role)) ?? null;
}

export const landingPath = paths.dashboard;
const accountPath = /^\/account(\/[^/\\]*)*$/i;
/** Returns only a same-app workspace location recorded by the sign-in link; anything else lands on Overview. */
export function loginDestination(state: unknown): string {
  const from =
    state && typeof state === "object" ? (state as Record<string, unknown>).from : undefined;
  if (!from || typeof from !== "object") return landingPath;
  const { pathname, search = "", hash = "" } = from as Record<string, unknown>;
  if (
    typeof pathname !== "string" ||
    typeof search !== "string" ||
    typeof hash !== "string" ||
    !accountPath.test(pathname) ||
    pathname.includes("//") ||
    // Dot segments would resolve outside the protected workspace (e.g. /account/../login).
    /(^|\/)\.{1,2}(\/|$)/.test(pathname) ||
    !(search === "" || /^\?[^#]*$/.test(search)) ||
    !(hash === "" || hash.startsWith("#"))
  )
    return landingPath;
  return `${pathname}${search}${hash}`;
}

export const sidebarStorageKey = "vtc.sidebar.collapsed";
