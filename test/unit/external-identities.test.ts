import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { createExternalIdentities } from "../../apps/api/src/modules/external-identities/service.ts";
import {
  authorizationUrl,
  parseAssertion,
  parseTruckers,
  providerDeadlineMs,
  ProviderFailure,
  returnUrl,
  steamEndpoint,
  steamId,
  steamProvider,
  truckersProvider,
} from "../../apps/api/src/modules/external-identities/providers.ts";

const sid = "76561190000000001",
  namespace = "http://specs.openid.net/auth/2.0";
const instant = new Date("2026-10-20T12:00:00.000Z");
const expected = returnUrl("http://127.0.0.1:4173", randomUUID(), "synthetic-state");
function assertion() {
  return new URLSearchParams({
    verificationId: randomUUID(),
    state: "synthetic-state",
    "openid.ns": namespace,
    "openid.mode": "id_res",
    "openid.op_endpoint": steamEndpoint,
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${sid}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${sid}`,
    "openid.return_to": expected,
    "openid.response_nonce": "2026-10-20T11:59:59Zsynthetic",
    "openid.assoc_handle": "synthetic",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": Buffer.alloc(32, 1).toString("base64"),
  });
}
const receipt = () => new Response(`ns:${namespace}\nis_valid:true\n`);
test("external commands preserve unknown COMMIT before any nested constraint mapping and never retry it", async () => {
  const failure = new TransactionCommitOutcomeUnknownError(
    Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_DUP_ENTRY" }),
  );
  const run = vi.fn(async () => {
    throw new Error("SYNTHETIC_REPOSITORY_WRAPPER", { cause: failure });
  });
  const unit: UnitOfWork = {
    run,
    client: () => {
      throw new Error("UNEXPECTED_CLIENT");
    },
    close: async () => {},
  };
  const identity = createIdentity(unit, {
    origin: "http://127.0.0.1:4173",
    secret: "nonfunctional-synthetic-secret-only-42",
    production: false,
  });
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    createExternalIdentities(unit, identity).refresh({
      userId: randomUUID(),
      sessionId: randomUUID(),
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: [],
    }),
  ).rejects.toBe(failure);
  expect(run).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls).includes("SYNTHETIC_PRIVATE")).toBe(false);
});
afterEach(() => vi.useRealTimers());
test("Steam preserves exact string IDs and constructs the pinned discovery endpoint/realm", async () => {
  expect(steamId(sid)).toBe(sid);
  for (const value of [Number(sid), `${sid} `, "0", "https://example.invalid/id", null])
    expect(() => steamId(value)).toThrow(ProviderFailure);
  const url = new URL(authorizationUrl(expected, "http://127.0.0.1:4173"));
  expect(url.origin + url.pathname).toBe(steamEndpoint);
  expect(url.searchParams.get("openid.realm")).toBe("http://127.0.0.1:4173/");
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(steamEndpoint);
    expect(init?.redirect).toBe("error");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("openid.mode")).toBe("check_authentication");
    expect(body.has("state")).toBe(false);
    return receipt();
  });
  expect((await steamProvider(transport).verify(assertion(), expected, instant)).steamId).toBe(sid);
  expect(transport).toHaveBeenCalledTimes(1);
});
test.each([
  ["openid.ns", "wrong"],
  ["openid.mode", "setup_needed"],
  ["openid.op_endpoint", "https://example.invalid/verify"],
  ["openid.return_to", `${expected}&extra=true`],
  ["openid.claimed_id", `http://steamcommunity.com/openid/id/${sid}`],
  ["openid.identity", "https://steamcommunity.com/openid/id/76561190000000002"],
  ["openid.signed", "op_endpoint,claimed_id,identity,return_to,assoc_handle"],
  [
    "openid.signed",
    "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle,identity",
  ],
  ["openid.sig", "invalid"],
  ["openid.response_nonce", "2026-10-20T11:55:00Zexpired"],
  ["openid.response_nonce", "2026-10-20T12:01:01Zfuture"],
  ["openid.response_nonce", "2026-02-30T12:00:00Zinvalid"],
])("Steam rejects malformed or unbound %s before provider I/O", async (key, value) => {
  const transport = vi.fn<typeof fetch>(async () => receipt()),
    input = assertion();
  input.set(key, value);
  await expect(steamProvider(transport).verify(input, expected, instant)).rejects.toMatchObject({
    category: "invalid_response",
  });
  expect(transport).not.toHaveBeenCalled();
});
test.each([
  "state=a&state=b",
  "openid.sig=a&openid.sig=b",
  "unknown=true",
  `state=${"x".repeat(13000)}`,
  "state=%zz",
  "state=%00",
])("callback parser rejects duplicate/unsupported/bounded input %s", (raw) =>
  expect(() => parseAssertion(raw)).toThrow(ProviderFailure),
);
test.each([
  `ns:${namespace}\nis_valid:false\n`,
  `ns:${namespace}\nis_valid:true\nis_valid:true\n`,
  "is_valid:true\n",
  `ns:${namespace}\nis_valid:true\nprivate:value\n`,
])("Steam rejects invalid verification receipts", async (body) => {
  await expect(
    steamProvider(async () => new Response(body)).verify(assertion(), expected, instant),
  ).rejects.toMatchObject({ category: "invalid_response" });
});
test("provider bounds cover redirects, transport, status, bytes and a never-settling fetch", async () => {
  for (const [transport, category] of [
    [async () => new Response(null, { status: 302 }), "unavailable"],
    [async () => new Response(null, { status: 429 }), "rate_limited"],
    [async () => new Response(null, { status: 503 }), "unavailable"],
    [async () => new Response("x".repeat(65537)), "invalid_response"],
    [
      async () => {
        throw new Error("SYNTHETIC_TRANSPORT");
      },
      "transport",
    ],
  ] as const)
    await expect(truckersProvider(transport).lookup(sid)).rejects.toMatchObject({ category });
  vi.useFakeTimers();
  const pending = truckersProvider(() => new Promise(() => {})).lookup(sid);
  const rejected = expect(pending).rejects.toMatchObject({ category: "timeout" });
  await vi.advanceTimersByTimeAsync(providerDeadlineMs);
  await rejected;
});
const player = () => ({
  error: false,
  response: {
    steamID: sid,
    steamID64: Number(sid),
    id: 123,
    name: "Synthetic Driver",
    discord: "ignored",
    bans: ["ignored"],
    vtc: { id: 4, name: "Synthetic VTC", tag: "SYN", inVTC: true, memberID: 6 },
  },
});
test("TruckersMP keeps basic profile/exact Steam ID/VTC and explicit successful absences", async () => {
  const found = parseTruckers(player(), sid);
  expect(found).toEqual({
    found: true,
    profile: {
      playerId: "123",
      displayName: "Synthetic Driver",
      vtc: { inVtc: true, id: "4", name: "Synthetic VTC", tag: "SYN", memberId: "6" },
    },
  });
  expect(JSON.stringify(found).includes("discord")).toBe(false);
  const none = player();
  none.response.vtc = { id: 0, name: "", tag: "", inVTC: false, memberID: 0 };
  expect(parseTruckers(none, sid).profile?.vtc).toEqual({
    inVtc: false,
    id: null,
    name: null,
    tag: null,
    memberId: null,
  });
  expect(
    parseTruckers({ error: true, descriptor: "Unable to find player with that ID." }, sid),
  ).toEqual({ found: false, profile: null });
  const transport = vi.fn<typeof fetch>(async (url) => {
    expect(url).toBe(`https://api.truckersmp.com/v2/player/${sid}`);
    return Response.json(player());
  });
  expect((await truckersProvider(transport).lookup(sid)).found).toBe(true);
});
test("TruckersMP rejects mismatches, unsafe numeric IDs, missing fields and unspecified errors", () => {
  const mismatch = player();
  mismatch.response.steamID = "76561190000000002";
  const unsafe = player();
  unsafe.response.id = Number.MAX_SAFE_INTEGER + 1;
  for (const value of [
    mismatch,
    unsafe,
    { error: true, response: "provider maintenance" },
    { error: false, response: { steamID64: Number(sid) } },
    null,
  ])
    expect(() => parseTruckers(value, sid)).toThrow(ProviderFailure);
});
