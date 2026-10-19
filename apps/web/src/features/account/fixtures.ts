import type { DTO } from "./transport.js";
export const fixtureId = "41000000-0000-4000-8000-000000000017";
/** Nonfunctional, fictional contract fixtures for controlled rendering only. */
export function accountFixture(locale: "ru" | "en" = "en"): DTO["EnvelopeSelf"] {
  return {
    data: {
      member: {
        id: fixtureId,
        nickname: "Fictional Yukon Member",
        formerMember: false,
        roles: ["trainee"],
      },
      email: "member@example.invalid",
      emailVerified: false,
      capabilities: [
        "company.read",
        "events.respond",
        "trips.read_own_private",
        "trips.submit_own",
      ],
      preferences: { locale, displayTimezone: "UTC" },
      steamVerified: false,
      identityEpoch: 1,
      missingSetup: ["steam_identity"],
    },
    meta: { requestId: "synthetic-request" },
  };
}
