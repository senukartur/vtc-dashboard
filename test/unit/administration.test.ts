import { randomBytes } from "node:crypto";
import { newId } from "@vtc/db";
import { expect, test } from "vitest";
import { pagination } from "../../apps/api/src/modules/qualifications/pagination.ts";
import { frozenAttempt } from "../../apps/web/src/features/admin/attempt.ts";
import { administrationTranslations } from "../../apps/web/src/features/admin/translations.ts";

test("administration keysets are domain-separated and scoped to effective limit", () => {
  const key = randomBytes(32).toString("hex"),
    actor = {
      userId: newId(),
      sessionId: newId(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: [],
    },
    page = pagination(key, "administration"),
    rows = [{ id: newId() }, { id: newId() }];
  const cursor = page(actor, ["members", "active"], { limit: 1 }).finish(rows, (row) => ({
    id: row.id,
    time: null,
  })).nextCursor as string;
  expect(page(actor, ["members", "active"], { limit: 1, cursor }).after?.id).toBe(rows[0]?.id);
  expect(() => page(actor, ["members", "active"], { limit: 2, cursor })).toThrow();
  expect(() => pagination(key)(actor, ["members", "active"], { limit: 1, cursor })).toThrow();
});
test("uncertain commands freeze target/body/key/etag until explicitly resolved", () => {
  const first = frozenAttempt(
    "/admin/members/fictional/roles",
    "PUT",
    { roles: ["driver"] },
    '"v2"',
    null,
  );
  const retry = frozenAttempt(
    "/admin/members/different/roles",
    "PUT",
    { roles: ["dispatcher"] },
    '"v99"',
    first,
  );
  expect(retry).toBe(first);
  expect(retry.body).toEqual({ roles: ["driver"] });
  expect(retry.etag).toBe('"v2"');
  const fresh = frozenAttempt(first.path, first.method, first.body, first.etag, null);
  expect(fresh.key).not.toBe(first.key);
});

test("administration HMAC accepts the identity owner's non-hex secret without collapsing keys", () => {
  const actor = {
      userId: newId(),
      sessionId: newId(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: [],
    },
    first = pagination("first-fictional-nonhex-identity-secret", "administration"),
    second = pagination("second-fictional-nonhex-identity-secret", "administration"),
    rows = [{ id: newId() }, { id: newId() }];
  const cursor = first(actor, ["members"], { limit: 1 }).finish(rows, (row) => ({
    id: row.id,
    time: null,
  })).nextCursor as string;
  expect(first(actor, ["members"], { cursor, limit: 1 }).after?.id).toBe(rows[0]?.id);
  expect(() => second(actor, ["members"], { cursor, limit: 1 })).toThrow();
});
test("administration RU/EN resources cover the same operational states", () => {
  function keys(value: object, prefix = ""): string[] {
    return Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === "object" ? keys(item, `${prefix}${key}.`) : [`${prefix}${key}`],
      )
      .sort();
  }
  expect(keys(administrationTranslations.en)).toEqual(keys(administrationTranslations.ru));
});
