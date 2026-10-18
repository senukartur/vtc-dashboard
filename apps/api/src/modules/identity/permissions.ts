export const assignableRoles = ["trainee", "driver", "dispatcher", "deputy_director"] as const;
export type AssignableRole = (typeof assignableRoles)[number];
export type Role = AssignableRole | "director";

const administration = [
  "applications.manage",
  "events.manage",
  "qualifications.manage",
  "members.manage",
  "connections.manage",
  "company.configure",
];
export function capabilities(roles: readonly Role[]): string[] {
  const result = new Set(["company.read", "trips.read_own_private"]);
  if (roles.some((role) => role === "trainee" || role === "driver"))
    for (const capability of ["trips.submit_own", "events.respond"]) result.add(capability);
  if (roles.some((role) => ["dispatcher", "deputy_director", "director"].includes(role)))
    result.add("trips.review");
  if (roles.some((role) => role === "deputy_director" || role === "director"))
    for (const capability of administration) result.add(capability);
  if (roles.includes("director")) result.add("leadership.transfer");
  return [...result].sort();
}

export function requireCapability(
  actor: { capabilities: readonly string[] },
  capability: string,
): void {
  if (!actor.capabilities.includes(capability))
    throw Object.assign(new Error("FORBIDDEN"), { statusCode: 403 });
}

// Call again under the owning trip/revision locks for decisions, corrections and reconciliation.
export function guardManualReview(
  actor: { userId: string; capabilities: readonly string[] },
  authorUserId: string,
): void {
  requireCapability(actor, "trips.review");
  if (actor.userId === authorUserId)
    throw Object.assign(new Error("SELF_REVIEW_FORBIDDEN"), {
      statusCode: 403,
      publicCode: "SELF_REVIEW_FORBIDDEN",
    });
}
