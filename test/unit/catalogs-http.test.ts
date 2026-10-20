import { expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import type { Catalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import type { Actor, Identity } from "../../apps/api/src/modules/identity/service.ts";
import { artifact } from "../fixtures/catalogs/synthetic.ts";

test("multipart streaming admits exactly one bounded JSON file without changing its uploaded bytes", async () => {
  const config = { secret: "a".repeat(64), origin: "http://127.0.0.1:4173", production: false },
    actor: Actor = {
      userId: "10000000-0000-4000-8000-000000000001",
      sessionId: "20000000-0000-4000-8000-000000000001",
      accessEpoch: 1,
      credentialEpoch: 1,
      capabilities: ["qualifications.manage"],
    };
  const received: Buffer[] = [],
    identity = { config, authenticate: async () => actor } as unknown as Identity;
  const catalogs = {
    config: { maxFileBytes: 16384 },
    authorize: async () => {},
    upload: async (_actor: Actor, _key: string, bytes: Buffer) => {
      received.push(bytes);
      return { id: actor.userId, state: "ready", sha256: "a".repeat(64), byteLength: bytes.length };
    },
  } as unknown as Catalogs;
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    const bytes = JSON.stringify(artifact()),
      payload = `--synthetic\r\nContent-Disposition: form-data; name="file"; filename="fixture.json"\r\nContent-Type: application/json\r\n\r\n${bytes}\r\n--synthetic--\r\n`;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: {
        cookie: "fixture=placeholder",
        origin: config.origin,
        "x-csrf-token": csrfProtection(config).issue({}, actor).token,
        "idempotency-key": actor.userId,
        "content-type": "multipart/form-data; boundary=synthetic",
      },
      payload,
    });
    expect({ status: response.statusCode, body: response.json() }).toMatchObject({ status: 202 });
    expect(received[0]?.toString()).toBe(bytes);
    const oversized = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: {
        cookie: "fixture=placeholder",
        origin: config.origin,
        "x-csrf-token": csrfProtection(config).issue({}, actor).token,
        "idempotency-key": actor.userId,
        "content-type": "multipart/form-data; boundary=synthetic",
      },
      payload: payload.replace(bytes, "x".repeat(16385)),
    });
    expect(oversized.statusCode).toBe(413);
    expect(received).toHaveLength(1);
    const aggregate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: {
        cookie: "fixture=placeholder",
        origin: config.origin,
        "x-csrf-token": csrfProtection(config).issue({}, actor).token,
        "idempotency-key": actor.userId,
        "content-type": "multipart/form-data; boundary=synthetic",
      },
      payload: payload.replace(bytes, "x".repeat(40000)),
    });
    expect(aggregate.statusCode).toBe(413);
    expect(received).toHaveLength(1);
  } finally {
    await app.close();
  }
});
