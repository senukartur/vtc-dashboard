import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
test("leadership confirmation cannot supply a successor and safe audit rejects private payload", () => {
  const id = "03800000-0000-4000-8000-000000000001";
  expect(valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL" })).toBe(true);
  expect(
    valid("LeadershipConfirmInput")({ challengeId: id, code: "NONFUNCTIONAL", successorId: id }),
  ).toBe(false);
  const audit = {
    id,
    actorId: null,
    action: "configuration.changed",
    subjectId: id,
    occurredAt: "2026-10-26T12:00:00.000Z",
  };
  expect(valid("AuditEntry")(audit)).toBe(true);
  for (const field of ["reason", "email", "token", "payload", "link"])
    expect(valid("AuditEntry")({ ...audit, [field]: "PRIVATE_PLACEHOLDER" })).toBe(false);
  expect(valid("ReinstateInput")({ roles: ["driver"], assignments: [], reason: "Fictional" })).toBe(
    false,
  );
});
test("leadership challenge state exposes only bounded safe pending fields and resend time", () => {
  const id = "06500000-0000-4000-8000-000000000001",
    successor = {
      id: "06500000-0000-4000-8000-000000000002",
      nickname: "Fictional Successor",
      formerMember: false,
      roles: ["driver"],
    },
    pending = {
      id,
      successor,
      expiresAt: "2026-10-26T12:10:00.000Z",
      attemptsRemaining: 5,
    },
    state = valid("LeadershipChallengeState");
  expect(valid("MemberSummary")(successor)).toBe(true);
  for (const attemptsRemaining of [1, 2, 3, 4, 5])
    expect(
      state({
        pending: { ...pending, attemptsRemaining },
        resendAvailableAt: "2026-10-26T12:01:00.000Z",
      }),
    ).toBe(true);
  expect(state({ pending: null, resendAvailableAt: null })).toBe(true);
  expect(state({ pending: null, resendAvailableAt: "2026-10-26T13:00:00.000Z" })).toBe(true);
  for (const attemptsRemaining of [0, 6, 2.5])
    expect(state({ pending: { ...pending, attemptsRemaining }, resendAvailableAt: null })).toBe(
      false,
    );
  for (const field of ["code", "secretHash", "email", "successorId", "emailEpoch"])
    expect(
      state({ pending: { ...pending, [field]: "PRIVATE_PLACEHOLDER" }, resendAvailableAt: null }),
    ).toBe(false);
  expect(state({ pending, resendAvailableAt: null, successorId: successor.id })).toBe(false);
  expect(
    state({ pending: { ...pending, successor: { id: successor.id } }, resendAvailableAt: null }),
  ).toBe(false);
  expect(state({ pending })).toBe(false);
  expect(state({ pending, resendAvailableAt: "2026-10-26 12:01" })).toBe(false);
  // The shared email-flow Challenge shape is unchanged.
  expect(valid("Challenge")({ id, expiresAt: "2026-10-26T12:10:00.000Z", state: "pending" })).toBe(
    true,
  );
  expect(
    valid("Challenge")({
      id,
      expiresAt: "2026-10-26T12:10:00.000Z",
      state: "pending",
      attemptsRemaining: 5,
    }),
  ).toBe(false);
});
test("direct membership input accepts only Trainee/Driver with a bounded reason", () => {
  const input = valid("MembershipInput");
  for (const membership of ["trainee", "driver"])
    expect(input({ membership, reason: "Fictional membership change" })).toBe(true);
  for (const membership of ["director", "dispatcher", "deputy_director", "", null])
    expect(input({ membership, reason: "Fictional membership change" })).toBe(false);
  expect(input({ membership: "driver" })).toBe(false);
  expect(input({ membership: "driver", reason: "" })).toBe(false);
  expect(input({ membership: "driver", reason: "x".repeat(2049) })).toBe(false);
  expect(input({ reason: "Fictional membership change" })).toBe(false);
  for (const extra of [{ roles: ["driver"] }, { qualifications: [] }, { director: true }])
    expect(input({ membership: "driver", reason: "Fictional", ...extra })).toBe(false);
});
test("member administration rows require a nullable millisecond UTC last accepted trip", () => {
  const id = "06400000-0000-4000-8000-000000000001",
    row = {
      profile: {
        member: { id, nickname: "Fictional Driver", formerMember: false, roles: ["driver"] },
        qualifications: [],
      },
      email: "fictional-driver@example.invalid",
      status: "active",
      accessEpoch: 1,
      identityEpoch: 1,
      version: 1,
    },
    member = valid("MemberAdmin");
  expect(member(row)).toBe(false);
  expect(member({ ...row, lastAcceptedTripAt: null })).toBe(true);
  expect(member({ ...row, lastAcceptedTripAt: "2026-10-20T18:30:00.000Z" })).toBe(true);
  for (const lastAcceptedTripAt of [
    "2026-10-20T18:30:00Z",
    "2026-10-20T18:30:00.000+03:00",
    "2026-10-20 18:30:00.000",
    "2026-10-20",
    "",
    0,
  ])
    expect(member({ ...row, lastAcceptedTripAt })).toBe(false);
  expect(
    valid("ListMemberAdmin")({ items: [{ ...row, lastAcceptedTripAt: null }], nextCursor: null }),
  ).toBe(true);
});
