import { describe, expect, test } from "vitest";
import {
  checkView,
  newerCheck,
  pollDelay,
  recheckFeedback,
  referralView,
  type TruckersmpCheck,
} from "../../apps/web/src/features/admin/application-checks-model.ts";
import { applicationChecksTranslations } from "../../apps/web/src/features/admin/application-checks-translations.ts";

const checkedAt = "2026-11-10T09:30:00.000Z",
  attemptAt = "2026-11-10T09:45:00.000Z",
  profileUrl = "https://truckersmp.com/user/900000000000001";
const empty: TruckersmpCheck = {
  state: "not_checked",
  notCheckedReason: null,
  found: null,
  playerId: null,
  displayName: null,
  profileUrl: null,
  bans: null,
  vtc: null,
  checkedAt: null,
  lastAttemptAt: null,
  failure: null,
};
const found = (extra: Partial<TruckersmpCheck> = {}): TruckersmpCheck => ({
  ...empty,
  state: "completed",
  found: true,
  playerId: "900000000000001",
  displayName: "Fictional Driver",
  profileUrl,
  bans: { any: false, count: 0 },
  vtc: { inVtc: true, id: "900001", name: "Fictional Other VTC", tag: "FOV" },
  checkedAt,
  lastAttemptAt: checkedAt,
  ...extra,
});
const keys = (parts: { key: string }[] | null) => parts?.map((part) => part.key) ?? null;
const part = (check: TruckersmpCheck, key: string) =>
  checkView(check).parts.find((item) => item.key === key);

describe("checkView", () => {
  test("a found player shows the linked name, bans, VTC and check time with Check again", () => {
    const view = checkView(found());
    expect(keys(view.parts)).toEqual(["found", "player", "noBans", "vtc", "checkedAt"]);
    expect(view.parts[1]).toEqual({ key: "player", text: "Fictional Driver", href: profileUrl });
    expect(view.parts[3]).toEqual({ key: "vtc", text: "Fictional Other VTC [FOV]" });
    expect(view.parts[4]).toEqual({ key: "checkedAt", at: checkedAt });
    expect(view).toMatchObject({ live: false, previous: null, recheck: "recheck" });
  });
  test("bans: a count, a ban flag without a count, none, or unavailable for staff accounts", () => {
    expect(part(found({ bans: { any: true, count: 3 } }), "bans")).toEqual({
      key: "bans",
      count: 3,
    });
    expect(part(found({ bans: { any: false, count: 2 } }), "bans")?.count).toBe(2);
    expect(part(found({ bans: { any: true, count: 0 } }), "banned")).toBeDefined();
    expect(part(found({ bans: { any: false, count: 0 } }), "noBans")).toBeDefined();
    expect(part(found({ bans: null }), "bansHidden")).toBeDefined();
  });
  test("VTC: not in one, name and tag, either alone, or membership without either", () => {
    const vtc = (value: TruckersmpCheck["vtc"]) =>
      checkView(found({ vtc: value })).parts.find((item) =>
        ["vtc", "inVtc", "notInVtc"].includes(item.key),
      );
    expect(vtc({ inVtc: false, id: null, name: null, tag: null })).toEqual({ key: "notInVtc" });
    expect(vtc({ inVtc: true, id: "1", name: "Fictional Other VTC", tag: null })).toEqual({
      key: "vtc",
      text: "Fictional Other VTC",
    });
    expect(vtc({ inVtc: true, id: "1", name: null, tag: "FOV" })).toEqual({
      key: "vtc",
      text: "[FOV]",
    });
    expect(vtc({ inVtc: true, id: "1", name: " ", tag: "" })).toEqual({ key: "inVtc" });
    expect(vtc(null)).toBeUndefined();
  });
  test("a found player without a display name or profile link keeps the other facts", () => {
    expect(keys(checkView(found({ displayName: null, profileUrl: null })).parts)).toEqual([
      "found",
      "noBans",
      "vtc",
      "checkedAt",
    ]);
    expect(
      checkView(found({ profileUrl: null })).parts.find((item) => item.key === "player"),
    ).toEqual({ key: "player", text: "Fictional Driver" });
  });
  test("a player who is not found differs from a failed check and offers Check again", () => {
    const view = checkView({ ...empty, state: "completed", found: false, checkedAt });
    expect(view.parts).toEqual([{ key: "notFound" }, { key: "checkedAt", at: checkedAt }]);
    expect(view.recheck).toBe("recheck");
  });
  test("a vanity /id/ link is not checked and hides the recheck the API would refuse", () => {
    expect(checkView({ ...empty, notCheckedReason: "steam_vanity_url" })).toEqual({
      parts: [{ key: "vanity" }],
      live: false,
      previous: null,
      recheck: "hidden",
    });
  });
  test("a canonical link that was never checked offers Check now", () => {
    for (const reason of ["not_requested", null] as const)
      expect(checkView({ ...empty, notCheckedReason: reason })).toMatchObject({
        parts: [{ key: "notRequested" }],
        recheck: "check",
      });
  });
  test("a running check is a live status without a button and keeps the previous result", () => {
    expect(checkView({ ...empty, state: "checking", lastAttemptAt: attemptAt })).toEqual({
      parts: [{ key: "checking" }],
      live: true,
      previous: null,
      recheck: "hidden",
    });
    const rerun = checkView(found({ state: "checking", lastAttemptAt: attemptAt }));
    expect(rerun.live).toBe(true);
    expect(keys(rerun.previous)).toEqual(["found", "player", "noBans", "vtc", "checkedAt"]);
    expect(rerun.previous?.at(-1)).toEqual({ key: "checkedAt", at: checkedAt });
    expect(
      keys(checkView({ ...empty, state: "checking", found: false, checkedAt }).previous),
    ).toEqual(["notFound", "checkedAt"]);
  });
  test("a failed check names the category and attempt, keeps the previous result and offers a recheck", () => {
    const failed = checkView({
      ...empty,
      state: "failed",
      failure: "timeout",
      lastAttemptAt: attemptAt,
    });
    expect(failed).toEqual({
      parts: [
        { key: "failed", reason: "timeout" },
        { key: "attempted", at: attemptAt },
      ],
      live: false,
      previous: null,
      recheck: "recheck",
    });
    const withPrevious = checkView(
      found({ state: "failed", failure: "rate_limited", lastAttemptAt: attemptAt }),
    );
    expect(withPrevious.parts[0]).toEqual({ key: "failed", reason: "rate_limited" });
    expect(keys(withPrevious.previous)).toEqual(["found", "player", "noBans", "vtc", "checkedAt"]);
    expect(
      checkView({ ...empty, state: "failed", failure: null, lastAttemptAt: null }).parts,
    ).toEqual([{ key: "failed", reason: "unavailable" }]);
  });
  test("an absent check shows no data and no button", () => {
    for (const value of [undefined, null])
      expect(checkView(value)).toEqual({
        parts: [{ key: "noData" }],
        live: false,
        previous: null,
        recheck: "hidden",
      });
  });
});

describe("polling and recheck feedback", () => {
  test("poll delays ramp 5, 10, 20, 30 s and then stay at one minute", () => {
    expect([0, 1, 2, 3, 4, 5, 40].map(pollDelay)).toEqual([
      5000, 10000, 20000, 30000, 60000, 60000, 60000,
    ]);
  });
  test("the fresher of the detail and poll results is shown", () => {
    const detail = found({ state: "checking" }),
      polled = found();
    expect(newerCheck(detail, 100, undefined, 0)).toBe(detail);
    expect(newerCheck(detail, 100, polled, 200)).toBe(polled);
    expect(newerCheck(detail, 300, polled, 200)).toBe(detail);
    expect(newerCheck(detail, 100, null, 200)).toBeNull();
  });
  test("failed rechecks map to safe feedback; anything unexpected stays uncertain", () => {
    for (const kind of ["forbidden", "conflict", "unavailable", "limited"])
      expect(recheckFeedback(kind)).toBe(kind);
    for (const kind of ["uncertain", "invalid", "unauthorized"])
      expect(recheckFeedback(kind)).toBe("uncertain");
  });
});

describe("referralView", () => {
  const fields = {
    nickname: "Fictional Applicant",
    email: "applicant@example.invalid",
    steamProfileUrl: "https://steamcommunity.com/profiles/76561190000000001",
    games: ["ets2" as const],
  };
  test("earlier applications without an answer, a source, other with and without text", () => {
    expect(referralView(fields)).toEqual({ kind: "none" });
    expect(referralView({ ...fields, referralSource: "friend_or_member" })).toEqual({
      kind: "source",
      source: "friend_or_member",
    });
    expect(referralView({ ...fields, referralSource: "other" })).toEqual({
      kind: "source",
      source: "other",
    });
    expect(
      referralView({ ...fields, referralSource: "other", referralOther: " Fictional poster " }),
    ).toEqual({ kind: "other", text: " Fictional poster " });
  });
});

describe("applicationChecks translations", () => {
  const base = (key: string) => key.replace(/_(?:zero|one|two|few|many|other)$/, "");
  function flatten(value: object, prefix = ""): string[] {
    return Object.entries(value).flatMap(([key, item]) =>
      typeof item === "object" && item
        ? flatten(item, `${prefix}${key}.`)
        : [`${prefix}${base(key)}`],
    );
  }
  function values(value: object): string[] {
    return Object.values(value).flatMap((item) =>
      typeof item === "object" && item ? values(item) : [String(item)],
    );
  }
  test("RU and EN have the same keys apart from plural forms, and every string is filled", () => {
    const ru = [...new Set(flatten(applicationChecksTranslations.ru))].sort(),
      en = [...new Set(flatten(applicationChecksTranslations.en))].sort();
    expect(ru).toEqual(en);
    for (const language of ["ru", "en"] as const)
      for (const text of values(applicationChecksTranslations[language]))
        expect(text.trim()).not.toBe("");
  });
  test("RU ban counts carry every Russian plural form", () => {
    for (const form of ["one", "few", "many", "other"])
      expect(applicationChecksTranslations.ru).toHaveProperty(`bans_${form}`);
    for (const form of ["one", "other"])
      expect(applicationChecksTranslations.en).toHaveProperty(`bans_${form}`);
  });
});
