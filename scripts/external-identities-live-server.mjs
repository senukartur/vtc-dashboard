import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, settingsFromEnvironment } from "@vtc/db";
import { sql } from "@vtc/db/identity-schema";
import { createApp } from "../apps/api/dist/app.js";
import {
  createExternalIdentities,
  steamProjection,
} from "../apps/api/dist/modules/external-identities/service.js";
import { createIdentity } from "../apps/api/dist/modules/identity/service.js";
import { identityAccessEvents } from "../apps/api/dist/platform/outbox/events.js";

let unit, app;
try {
  const run = process.env.LIVE_RUN ?? "",
    sha = process.env.LIVE_SHA ?? "",
    port = Number(process.env.LIVE_PORT);
  const settings = settingsFromEnvironment();
  if (
    process.env.LIVE_ACK !== "owner-assisted-steam-only" ||
    process.env.NODE_ENV !== "test" ||
    !/^[a-f0-9]{16}$/.test(run) ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    settings.host !== "db" ||
    settings.database !== `vtc_live_${run}` ||
    settings.user !== `live_${run}`
  )
    throw new Error();
  await runMigrations(settings);
  unit = createUnitOfWork(settings);
  const ownedUnit = unit;
  const empty = await ownedUnit.run(async (tx) => {
    const [rows] = await ownedUnit.client(tx).execute(sql`SELECT COUNT(*) n FROM identity_users`);
    return Array.isArray(rows) && Number(rows[0]?.n) === 0;
  });
  if (!empty) throw new Error();
  const origin = `http://127.0.0.1:${port}`,
    password = randomBytes(32).toString("base64url"),
    email = "local-steam-check@example.invalid";
  const identity = createIdentity(
    ownedUnit,
    { origin, secret: process.env.IDENTITY_SECRET ?? "", production: false },
    { accessEvents: identityAccessEvents(ownedUnit), steamProjection: steamProjection(ownedUnit) },
  );
  await identity.bootstrap({ email, name: "Synthetic Local Steam Check", password });
  const external = createExternalIdentities(ownedUnit, identity);
  let result = {
    event: "external_identity_live",
    candidate: sha,
    state: "pending",
    verified: false,
    passwordLogin: false,
    replayRejected: false,
    truckersStatus: "not_checked",
  };
  const observed = {
    ...external,
    async callback(actor, raw) {
      const completed = await external.callback(actor, raw);
      const current = await identity.current(actor);
      let replayRejected = false;
      try {
        await external.callback(actor, raw);
      } catch (error) {
        replayRejected =
          error && typeof error === "object" && "statusCode" in error && error.statusCode === 401;
      }
      const fresh = await identity.login(email, password);
      const profile = await external.current(actor);
      result = {
        event: "external_identity_live",
        candidate: sha,
        state: "completed",
        verified: current.data.steamVerified,
        passwordLogin: fresh.data.member.id === actor.userId,
        replayRejected,
        truckersStatus: profile.data.truckersMp.status,
      };
      return completed;
    },
  };
  app = await createApp({
    identity,
    externalIdentities: observed,
    checkReadiness: async () => true,
    closeDatabase: () => ownedUnit.close(),
  });
  app.get("/live/start", async (_request, reply) => {
    if (result.state !== "pending")
      return reply.code(409).type("text/plain").send("This local check is already complete.");
    const signed = await identity.login(email, password),
      cookie = signed.cookies.map((value) => value.split(";", 1)[0]).join("; "),
      actor = await identity.authenticate(new Headers({ cookie }));
    const proof = await external.request(actor, newId(), "initial");
    reply
      .header("Set-Cookie", signed.cookies)
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    return reply.redirect(proof.verificationUrl, 303);
  });
  app.get("/live/result", async (_request, reply) =>
    reply.header("Referrer-Policy", "no-referrer").send(result),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () =>
      app.close().catch(() => {
        process.exitCode = 1;
      }),
    );
  await app.listen({ host: "0.0.0.0", port: 3000 });
  console.log("LOCAL_STEAM_CHECK_READY");
} catch {
  console.error("LOCAL_STEAM_CHECK_FAILED");
  await app?.close().catch(() => {});
  await unit?.close().catch(() => {});
  process.exitCode = 1;
}
