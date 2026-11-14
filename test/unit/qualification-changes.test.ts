import { expect, test } from "vitest";
import {
  affectedQualificationProjection,
  affectedRead,
  commandChange,
  deferPagedQualificationRead,
  validateChangedResult,
} from "../../apps/web/src/features/qualifications/changes.ts";

const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const level = {
  id,
  game: "ets2",
  position: 1,
  terminal: false,
  promotionConfigured: true,
  name: "Fictional",
  version: 2,
  ruleVersionId: other,
  configured: true,
  freightRuleSummary: {
    maxMassKg: "10",
    allowedTrailerTypeCount: null,
    allowedAdrCategoryCount: 0,
  },
  requiredTrips: 1,
  requiredDistanceM: "100",
};
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-change" } });
test("ladder refresh covers readiness and relocation projections while preserving other game progress", () => {
  const add = { kind: "ladder", game: "ets2", archive: false } as const;
  const archive = { ...add, archive: true };
  const settings = ["administration", "/admin/company-settings", "EnvelopeCompanySettings"];
  const members = ["administration", "/admin/members?limit=25", "EnvelopeListMemberAdmin"];
  const profile = ["driver-profile", "/members/fixture"];
  expect(affectedQualificationProjection(add, settings)).toBe(true);
  expect(affectedQualificationProjection(add, members)).toBe(false);
  expect(affectedQualificationProjection(archive, members)).toBe(true);
  expect(affectedQualificationProjection(archive, profile)).toBe(true);
  for (const game of ["ets2", "ats"])
    expect(
      affectedQualificationProjection(archive, [
        "driver-progress",
        `/members/fixture/qualification-progress?game=${game}`,
      ]),
    ).toBe(game === "ets2");
});
test("closed command success must belong to the requested level and game before affecting private caches", () => {
  const owner = { kind: "level", id, game: "ets2" } as const;
  const change = commandChange(
    owner,
    `/admin/qualification-levels/${id}/rule-versions`,
    {},
    "POST",
  );
  expect(validateChangedResult(change, "EnvelopeQualificationLevel", envelope(level))).toEqual(
    level,
  );
  for (const data of [
    { ...level, id: other },
    { ...level, game: "ats" },
    { ...level, private: true },
  ])
    expect(() =>
      validateChangedResult(change, "EnvelopeQualificationLevel", envelope(data)),
    ).toThrow();
  expect(() => commandChange(owner, `/admin/qualification-levels/${other}`, {}, "PATCH")).toThrow();
  expect(() =>
    commandChange(undefined, `/admin/qualification-levels/${id}`, {}, "PATCH"),
  ).toThrow();
});
test("all assignment purposes retain request ownership; promotion role impact follows the original target level", () => {
  const owner = { kind: "member", id, game: "ets2", rolePromotionLevelId: other } as const;
  for (const purpose of [
    "initial",
    "reinstatement",
    "administrative_correction",
    "historical_resolution",
  ]) {
    const change = commandChange(
      owner,
      `/admin/members/${id}/qualification-assignments`,
      { game: "ets2", levelId: other, purpose },
      "POST",
    );
    const assignment = {
      id,
      periodId: id,
      game: "ets2",
      levelId: other,
      assignedAt: "2026-10-20T12:00:00.000Z",
    };
    expect(
      validateChangedResult(change, "EnvelopeAssignment", envelope(assignment)),
    ).toBeUndefined();
    for (const data of [
      { ...assignment, periodId: other },
      { ...assignment, game: "ats" },
      { ...assignment, levelId: id },
    ])
      expect(() => validateChangedResult(change, "EnvelopeAssignment", envelope(data))).toThrow();
    expect(change).toMatchObject({
      kind: "member",
      id,
      game: "ets2",
      roleChange: false,
      historical: purpose === "historical_resolution",
    });
  }
  expect(
    commandChange(
      owner,
      `/admin/members/${id}/promotions`,
      { game: "ets2", targetLevelId: other },
      "POST",
    ),
  ).toMatchObject({ roleChange: true });
  expect(
    commandChange(
      owner,
      `/admin/members/${id}/promotions`,
      { game: "ets2", targetLevelId: id },
      "POST",
    ),
  ).toMatchObject({ roleChange: false });
  expect(() =>
    commandChange(
      owner,
      `/admin/members/${other}/promotions`,
      { game: "ets2", targetLevelId: other },
      "POST",
    ),
  ).toThrow();
  expect(() =>
    commandChange(
      owner,
      `/admin/members/${id}/promotions`,
      { game: "ats", targetLevelId: other },
      "POST",
    ),
  ).toThrow();
});
test("dependency refresh isolates target game and mutable history while immutable versions and unrelated reads stay valid", () => {
  const change = { kind: "level", id, game: "ets2", publication: true } as const;
  expect(affectedRead(change, "/qualification-levels?game=ets2", id)).toBe(true);
  expect(affectedRead(change, "/admin/members/target/qualification-progress?game=ets2", id)).toBe(
    true,
  );
  expect(
    affectedRead(change, `/admin/qualification-levels/${id}/rule-versions?cursor=old`, id),
  ).toBe(true);
  for (const path of [
    "/qualification-levels?game=ats",
    "/me/qualification-progress?game=ats",
    `/qualification-levels/${id}/rule-versions/${other}`,
    "/admin/qualification-members",
    "/me/qualification-assignments?game=ets2",
  ])
    expect(affectedRead(change, path, id)).toBe(false);
  const member = {
    kind: "member",
    id,
    game: "ets2",
    levelId: other,
    roleChange: false,
    historical: false,
  } as const;
  for (const suffix of [
    "qualification-progress",
    "qualification-action-history",
    "qualification-assignments",
  ])
    expect(affectedRead(member, `/admin/members/${id}/${suffix}?game=ets2&cursor=old`, other)).toBe(
      true,
    );
  expect(affectedRead(member, "/me/qualification-progress?game=ets2", id)).toBe(true);
  expect(affectedRead(member, "/me/qualification-progress?game=ets2", other)).toBe(false);
  expect(
    affectedRead(member, `/admin/members/${other}/qualification-progress?game=ets2`, other),
  ).toBe(false);
  expect(affectedRead(member, `/admin/members/${id}/qualification-progress?game=ats`, id)).toBe(
    false,
  );
  expect(affectedRead(member, "/admin/qualification-members", id)).toBe(false);
  expect(affectedRead({ ...member, roleChange: true }, "/admin/qualification-members", id)).toBe(
    true,
  );
});

test("promotion dependencies fence changed-game candidate cursors and affected company history", () => {
  const reorder = { kind: "ladder", game: "ets2", archive: false } as const;
  const archive = { ...reorder, archive: true };
  const rename = commandChange(
    { kind: "level", game: "ets2", id },
    `/admin/qualification-levels/${id}`,
    { name: "Fictional renamed level" },
    "PATCH",
  );
  const publication = commandChange(
    { kind: "level", game: "ets2", id },
    `/admin/qualification-levels/${id}/rule-versions`,
    {},
    "POST",
  );
  if (!rename || !publication) throw new Error("SYNTHETIC_CHANGE_REQUIRED");
  for (const change of [reorder, archive, rename, publication]) {
    for (const status of ["eligible", "all"]) {
      const path = `/admin/promotion-candidates?game=ets2&status=${status}`;
      expect(affectedRead(change, path, id)).toBe(true);
      expect(deferPagedQualificationRead(change, path)).toBe(false);
      expect(affectedRead(change, `${path}&cursor=old`, id)).toBe(true);
      expect(deferPagedQualificationRead(change, `${path}&cursor=old`)).toBe(true);
    }
    expect(affectedRead(change, "/admin/promotion-candidates?game=ats&cursor=valid", id)).toBe(
      false,
    );
    expect(affectedRead(change, "/admin/promotion-history?game=ats", id)).toBe(false);
  }
  const history = `/admin/promotion-history?game=ets2&memberId=${other}`;
  expect(affectedRead(reorder, history, id)).toBe(false);
  expect(affectedRead(publication, history, id)).toBe(false);
  for (const change of [archive, rename]) {
    expect(affectedRead(change, history, id)).toBe(true);
    expect(affectedRead(change, "/admin/promotion-history", id)).toBe(true);
    expect(deferPagedQualificationRead(change, `${history}&cursor=old`)).toBe(true);
  }
});

test("generic member writes refresh applicable promotion reads and defer to F2's own refresh", () => {
  const change = {
    kind: "member",
    id,
    game: "ets2",
    levelId: other,
    roleChange: false,
    historical: false,
  } as const;
  const candidates = "/admin/promotion-candidates?game=ets2";
  const history = "/admin/promotion-history?game=ets2";
  expect(affectedRead(change, candidates, id)).toBe(true);
  expect(affectedRead(change, history + "&memberId=" + id, id)).toBe(true);
  expect(affectedRead(change, history + "&memberId=" + other, id)).toBe(false);
  expect(affectedRead(change, candidates, id, false, false)).toBe(false);
  expect(affectedRead(change, history, id, false, false)).toBe(false);
  const historical = { ...change, historical: true };
  expect(affectedRead(historical, candidates, id)).toBe(true);
  expect(affectedRead(historical, history, id)).toBe(true);
});
