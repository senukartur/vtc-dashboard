// Pure view model for the applications queue and invitation block. It only decides what the
// page shows; request paths, bodies, ETags and command state stay in ApplicationsPage.

export type InviteState = "active" | "reserved" | "used" | "revoked" | "expired";
export type ApplicationStatus = "submitted" | "approved" | "rejected";
export type Availability = "hidden" | "disabled" | "enabled";

/**
 * `live` is the link the applicant can still redeem: an active generation before its expiry.
 * An active generation past its expiry is shown as expired; it can be reissued like one.
 */
export function invitationView(
  state: InviteState,
  expiresAt: string,
  now: number,
): {
  live: boolean;
  canReissue: boolean;
  badge: InviteState;
  line: "valid" | "expired" | "used" | "revoked" | "none";
} {
  const live = state === "active" && Date.parse(expiresAt) > now,
    expired = state === "expired" || (state === "active" && !live);
  return {
    live,
    canReissue: ["active", "expired"].includes(state),
    badge: expired ? "expired" : state,
    line: live
      ? "valid"
      : expired
        ? "expired"
        : state === "used"
          ? "used"
          : state === "revoked"
            ? "revoked"
            : "none",
  };
}

/**
 * Send and Retry follow the original inline conditions. Send exists only while no email was
 * requested; Retry only after a known failure. A link that is no longer live hides both instead
 * of disabling them. `mailEnabled` is null while the runtime capability is unknown (loading or
 * unavailable): Send stays disabled, but the page does not claim that mail is turned off.
 */
export function mailActions(input: {
  emailDelivery: string;
  mailState?: string | undefined;
  mailEnabled: boolean | null;
  live: boolean;
  busy: boolean;
}): {
  send: Availability;
  retry: Availability;
  hint: "notRequested" | "disabled" | "retry" | "help";
} {
  const failed = ["failed", "retryable"].includes(input.mailState ?? ""),
    notRequested = input.emailDelivery === "not_requested";
  return {
    send:
      !notRequested || !input.live
        ? "hidden"
        : input.busy || !input.mailEnabled
          ? "disabled"
          : "enabled",
    retry: !failed || !input.live ? "hidden" : input.busy ? "disabled" : "enabled",
    hint: notRequested
      ? input.mailEnabled === false
        ? "disabled"
        : "notRequested"
      : failed
        ? "retry"
        : "help",
  };
}

const tones = {
  submitted: { tone: "pending", symbol: "●" },
  approved: { tone: "accepted", symbol: "✓" },
  rejected: { tone: "rejected", symbol: "✕" },
} as const;
/** Status badges carry a symbol and text, never colour alone. */
export function applicationTone(status: ApplicationStatus): {
  tone: "pending" | "accepted" | "rejected";
  symbol: "●" | "✓" | "✕";
} {
  return tones[status];
}
