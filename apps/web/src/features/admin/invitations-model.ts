// Pure request paths of the drivers directory Invited tab (VTC-145, applications.manage only).
import { queryString } from "../../shared/paging.js";

export type InvitationListState = "active" | "expired";
export const INVITATIONS_PAGE_SIZE = 25;

/** One page of current invitation generations; the server never returns their links. */
export function invitationsPath(state: InvitationListState, cursor: string | null) {
  return `/admin/invitations?${queryString({ state, limit: INVITATIONS_PAGE_SIZE, cursor })}`;
}

/** The Invited counter: the active total from the smallest page. */
export const invitationCountPath = "/admin/invitations?state=active&limit=1";

/** Approved applications, where an invitation is copied, reissued or sent again. */
export const approvedApplicationsHref = "/account/admin/applications?status=approved";
