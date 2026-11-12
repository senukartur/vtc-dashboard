import type { useSession } from "../../app/Session.js";

/** VTC-124 supplies this flag on the authenticated session. An older API stays in legacy mode. */
export function isEventStage2Enabled(session: ReturnType<typeof useSession>) {
  return "eventsStage2Enabled" in session && session.eventsStage2Enabled === true;
}
