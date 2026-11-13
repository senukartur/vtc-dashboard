// Pure view model for the members table and administration panel (VTC-064). It decides what the
// page shows and builds request paths/bodies; command state, ETags and keys stay in the page.

export type Role = "trainee" | "driver" | "dispatcher" | "deputy_director" | "director";
export type AssignableRole = Exclude<Role, "director">;
export type Membership = "trainee" | "driver";
export type MembershipState = Membership | "none" | "both";
export type Additional = "dispatcher" | "deputy_director";
export type Game = "ets2" | "ats";
export type MemberStatus = "active" | "inactive";
export type RoleFilter = "deputy_director" | "dispatcher" | "driver" | "trainee";

/** Display order: the most senior role first. */
const displayOrder: readonly Role[] = [
  "director",
  "deputy_director",
  "dispatcher",
  "driver",
  "trainee",
];
/** Request order for `PUT /roles` and reinstatement: the RolesInput enum order. */
const bodyOrder: readonly AssignableRole[] = ["trainee", "driver", "dispatcher", "deputy_director"];
export const additionalRoles: readonly Additional[] = ["dispatcher", "deputy_director"];
export const roleFilters: readonly RoleFilter[] = [
  "deputy_director",
  "dispatcher",
  "driver",
  "trainee",
];
export const games: readonly Game[] = ["ets2", "ats"];

export function membershipOf(roles: readonly Role[]): MembershipState {
  const trainee = roles.includes("trainee"),
    driver = roles.includes("driver");
  return trainee && driver ? "both" : trainee ? "trainee" : driver ? "driver" : "none";
}

/** Dispatcher and Deputy Director held by the member, in a fixed order. */
export function additionalOf(roles: readonly Role[]): Additional[] {
  return additionalRoles.filter((role) => roles.includes(role));
}

export function orderedRoles(roles: readonly Role[]): Role[] {
  return displayOrder.filter((role) => roles.includes(role));
}

/**
 * The `PUT /roles` body roles: the server's membership roles as they are (one, both or none), the
 * selected additional roles, never Director, in the RolesInput order.
 */
export function rolesBody(
  serverRoles: readonly Role[],
  additional: readonly Additional[],
): AssignableRole[] {
  return bodyOrder.filter((role) =>
    role === "trainee" || role === "driver"
      ? serverRoles.includes(role)
      : additional.includes(role),
  );
}

export function roleDiff(
  serverRoles: readonly Role[],
  additional: readonly Additional[],
): { added: Additional[]; removed: Additional[] } {
  return {
    added: additionalRoles.filter(
      (role) => additional.includes(role) && !serverRoles.includes(role),
    ),
    removed: additionalRoles.filter(
      (role) => !additional.includes(role) && serverRoles.includes(role),
    ),
  };
}

/** The membership switch to confirm, or null when nothing would change. */
export function membershipChange(
  serverRoles: readonly Role[],
  selected: Membership | null,
): { from: MembershipState; to: Membership } | null {
  const from = membershipOf(serverRoles);
  return selected === null || selected === from ? null : { from, to: selected };
}

/**
 * Which panel sections show. The serving Director (the only member holding the Director role) is
 * protected: membership, roles and deactivation are shown unavailable; Steam replacement stays.
 */
export function memberPanel(member: { roles: readonly Role[]; status: MemberStatus }): {
  protected: boolean;
  roles: "editable" | "readonly" | "hidden";
  leave: "enabled" | "disabled" | "hidden";
  restore: boolean;
} {
  const guarded = member.roles.includes("director"),
    active = member.status === "active";
  return {
    protected: guarded,
    roles: !active ? "hidden" : guarded ? "readonly" : "editable",
    leave: !active ? "hidden" : guarded ? "disabled" : "enabled",
    restore: !active && !guarded,
  };
}

export type Filters = {
  status: MemberStatus;
  role: RoleFilter | null;
  search: string | null;
  cursor: string | null;
};
export const searchMaxLength = 128;
const loneSurrogate = /^[\uD800-\uDFFF]$/;

/**
 * Trimmed search of at most 128 code points, or null when blank. It is cut by code points and
 * drops unpaired surrogates, so the term always encodes into a URL.
 */
export function normalizeSearch(value: string): string | null {
  return (
    Array.from(value.trim())
      .filter((point) => !loneSurrogate.test(point))
      .slice(0, searchMaxLength)
      .join("")
      .trim() || null
  );
}

/** Validated URL filters: unknown values are ignored, a blank search is no search. */
export function parseFilters(params: URLSearchParams): Filters {
  const role = params.get("role");
  return {
    status: params.get("status") === "inactive" ? "inactive" : "active",
    role: roleFilters.includes(role as RoleFilter) ? (role as RoleFilter) : null,
    search: normalizeSearch(params.get("search") ?? ""),
    cursor: params.get("cursor") || null,
  };
}

/** URL parameters for the filters; status first so it stays the leading parameter. */
export function filterParams(filters: Filters): Record<string, string> {
  return {
    status: filters.status,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  };
}

export function listPath(filters: Filters): string {
  return `/admin/members?status=${filters.status}&limit=25${
    filters.role ? `&role=${filters.role}` : ""
  }${filters.search ? `&search=${encodeURIComponent(filters.search)}` : ""}${
    filters.cursor ? `&cursor=${encodeURIComponent(filters.cursor)}` : ""
  }`;
}

export type LevelOption = { id: string; game: Game; position: number; name: string };
export type LevelCell = "none" | "loading" | "unavailable" | { name: string; position: number };

/** The member's current level for one game, resolved through the reinstatement options read. */
export function levelCell(
  assignments: readonly { game: Game; levelId: string }[],
  game: Game,
  levels: readonly LevelOption[] | undefined,
  pending: boolean,
  error: boolean,
): LevelCell {
  const assignment = assignments.find((row) => row.game === game);
  if (!assignment) return "none";
  const level = levels?.find((row) => row.id === assignment.levelId && row.game === game);
  if (level) return { name: level.name, position: level.position };
  return pending && !error ? "loading" : "unavailable";
}

const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Null means no dated accepted trip is recorded, which also happens when the Trips module is not
 * configured; it never means the member has not driven.
 */
export function lastTrip(value: string | null): { kind: "none" } | { kind: "date"; iso: string } {
  return value === null ? { kind: "none" } : { kind: "date", iso: value };
}

/** Calendar day in the display timezone; null for a malformed value or timezone. */
export function formatDay(value: string, locale: "ru" | "en", timeZone: string): string | null {
  if (!isoPattern.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-GB", {
      dateStyle: "medium",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}

/** The existing reinstatement body: `{ roles, assignments, reason }`, ETS2 before ATS. */
export function reinstatementBody(
  membership: Membership,
  additional: readonly Additional[],
  levels: Readonly<Record<Game, string>>,
  reason: string,
): {
  roles: AssignableRole[];
  assignments: { game: Game; levelId: string; purpose: "reinstatement"; reason: string }[];
  reason: string;
} {
  return {
    roles: bodyOrder.filter((role) =>
      role === "trainee" || role === "driver"
        ? role === membership
        : additional.includes(role as Additional),
    ),
    assignments: games
      .filter((game) => levels[game])
      .map((game) => ({
        game,
        levelId: levels[game],
        purpose: "reinstatement" as const,
        reason,
      })),
    reason,
  };
}
