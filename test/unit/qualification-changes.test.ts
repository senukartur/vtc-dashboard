import { expect, test } from "vitest";
import {
  affectedRead,
  commandChange,
  validateChangedResult,
} from "../../apps/web/src/features/qualifications/changes.ts";

const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const level = {
  id,
  game: "ets2",
  code: "trainee",
  name: "Fictional",
  version: 2,
  ruleVersionId: other,
  configured: true,
  requiredTrips: 1,
  requiredDistanceM: "100",
};
const envelope = (data: unknown) => ({ data, meta: { requestId: "synthetic-change" } });
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
    expect(change).toMatchObject({ kind: "member", id, game: "ets2", roleChange: false });
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
  const change = { kind: "level", id, game: "ets2" } as const;
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
  const member = { kind: "member", id, game: "ets2", levelId: other, roleChange: false } as const;
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
