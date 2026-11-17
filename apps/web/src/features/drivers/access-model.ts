// Pure model of the drivers directory access panel (VTC-160). The panel calls the Members page
// commands unchanged: one membership switch or one role save per confirmation, never both, since
// the API has no combined command.
import {
  type Additional,
  type Membership,
  membershipChange,
  type Role,
  roleDiff,
  rolesBody,
} from "../admin/members-model.js";

export type AccessSave =
  | { kind: "none" }
  /** Both groups changed: the panel asks to save one and reset the other. */
  | { kind: "both" }
  | {
      kind: "membership";
      path: string;
      body: { membership: Membership; reason: string };
      change: NonNullable<ReturnType<typeof membershipChange>>;
    }
  | {
      kind: "roles";
      path: string;
      body: { roles: ReturnType<typeof rolesBody>; reason: string };
      diff: ReturnType<typeof roleDiff>;
    };

/** The single command the panel's Save sends, from the server roles and the edited choices. */
export function accessSave(
  memberId: string,
  serverRoles: readonly Role[],
  membership: Membership | null,
  additional: readonly Additional[],
  reason: string,
): AccessSave {
  const change = membershipChange(serverRoles, membership);
  const diff = roleDiff(serverRoles, additional);
  const rolesChanged = diff.added.length + diff.removed.length > 0;
  if (change && rolesChanged) return { kind: "both" };
  const base = `/admin/members/${encodeURIComponent(memberId)}`;
  if (change)
    return {
      kind: "membership",
      path: `${base}/membership`,
      body: { membership: change.to, reason },
      change,
    };
  if (rolesChanged)
    return {
      kind: "roles",
      path: `${base}/roles`,
      body: { roles: rolesBody(serverRoles, additional), reason },
      diff,
    };
  return { kind: "none" };
}
