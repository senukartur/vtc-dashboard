import { describe, expect, test } from "vitest";
import {
  applicationTone,
  type InviteState,
  invitationView,
  mailActions,
} from "../../apps/web/src/features/admin/applications-model.ts";
import { administrationTranslations } from "../../apps/web/src/features/admin/translations.ts";

const now = Date.parse("2026-11-02T12:00:00.000Z"),
  future = "2026-11-09T12:00:00.000Z",
  past = "2026-11-01T12:00:00.000Z";

describe("invitationView", () => {
  test("an active link before expiry is live and reissuable", () => {
    expect(invitationView("active", future, now)).toEqual({
      live: true,
      canReissue: true,
      badge: "active",
      line: "valid",
    });
  });
  test("an active link at or after expiry is shown as expired and stays reissuable", () => {
    for (const expiresAt of [new Date(now).toISOString(), past])
      expect(invitationView("active", expiresAt, now)).toEqual({
        live: false,
        canReissue: true,
        badge: "expired",
        line: "expired",
      });
  });
  test("an expired link is reissuable", () => {
    expect(invitationView("expired", past, now)).toEqual({
      live: false,
      canReissue: true,
      badge: "expired",
      line: "expired",
    });
  });
  test("used, replaced and reserved links are neither live nor reissuable", () => {
    for (const [state, line] of [
      ["used", "used"],
      ["revoked", "revoked"],
      ["reserved", "none"],
    ] as const)
      expect(invitationView(state, future, now)).toEqual({
        live: false,
        canReissue: false,
        badge: state,
        line,
      });
  });
  test("live and canReissue equal the page's original inline expressions", () => {
    const states: InviteState[] = ["active", "reserved", "used", "revoked", "expired"];
    for (const state of states)
      for (const expiresAt of [past, future]) {
        const view = invitationView(state, expiresAt, now);
        expect(view.live).toBe(state === "active" && Date.parse(expiresAt) > now);
        expect(view.canReissue).toBe(["active", "expired"].includes(state));
      }
  });
});

describe("mailActions", () => {
  const deliveries = [
    "not_requested",
    "queued",
    "attempting",
    "retryable",
    "accepted",
    "simulated",
    "suppressed",
    "failed",
    "ambiguous",
    "unavailable",
  ];
  const mailStates = [
    undefined,
    "queued",
    "attempting",
    "retryable",
    "accepted",
    "simulated",
    "suppressed",
    "failed",
    "ambiguous",
  ];
  test("matches the original visibility and disabled expressions, hiding controls of a dead link", () => {
    for (const emailDelivery of deliveries)
      for (const mailState of mailStates)
        for (const mailEnabled of [true, false, null])
          for (const live of [true, false])
            for (const busy of [true, false]) {
              const result = mailActions({ emailDelivery, mailState, mailEnabled, live, busy });
              // Original: rendered when not_requested, disabled when !valid || busy || !mail.
              const sendShown = emailDelivery === "not_requested",
                sendDisabled = !live || busy || !mailEnabled;
              // Original: rendered when the delivery is failed/retryable, disabled when !valid || busy.
              const retryShown = !!mailState && ["failed", "retryable"].includes(mailState),
                retryDisabled = !live || busy;
              expect(result.send).toBe(
                !sendShown || !live ? "hidden" : sendDisabled ? "disabled" : "enabled",
              );
              expect(result.retry).toBe(
                !retryShown || !live ? "hidden" : retryDisabled ? "disabled" : "enabled",
              );
              expect(result.hint).toBe(
                emailDelivery === "not_requested"
                  ? mailEnabled === null
                    ? "help"
                    : mailEnabled
                      ? "notRequested"
                      : "disabled"
                  : retryShown
                    ? "retry"
                    : "help",
              );
            }
  });
  test("an ambiguous delivery never offers Retry", () => {
    for (const live of [true, false])
      expect(
        mailActions({
          emailDelivery: "ambiguous",
          mailState: "ambiguous",
          mailEnabled: true,
          live,
          busy: false,
        }).retry,
      ).toBe("hidden");
  });
});

test("applicationTone pairs each status with a symbol and a tone", () => {
  expect(applicationTone("submitted")).toEqual({ tone: "pending", symbol: "●" });
  expect(applicationTone("approved")).toEqual({ tone: "accepted", symbol: "✓" });
  expect(applicationTone("rejected")).toEqual({ tone: "rejected", symbol: "✕" });
});

test("every applicationsUi string is non-empty in EN and RU", () => {
  function strings(value: object, prefix = ""): [string, string][] {
    return Object.entries(value).flatMap(([key, item]) =>
      typeof item === "object"
        ? strings(item as object, `${prefix}${key}.`)
        : [[`${prefix}${key}`, String(item)] as [string, string]],
    );
  }
  const en = strings(administrationTranslations.en.applicationsUi),
    ru = strings(administrationTranslations.ru.applicationsUi);
  expect(en.map(([key]) => key)).toEqual(ru.map(([key]) => key));
  for (const [key, text] of [...en, ...ru]) expect(text.trim(), key).not.toBe("");
  // The mockup slogan is never part of the product copy.
  expect(JSON.stringify(administrationTranslations)).not.toMatch(/Достаточно суров|Юкон\?/);
});
