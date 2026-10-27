import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createUnitOfWork, newId, settingsFromEnvironment } from "@vtc/db";
import { createQualificationInitialization } from "../dist/modules/qualifications/initialization.js";
import { createQueue } from "../dist/platform/jobs/queue.js";
import { runPass } from "../dist/platform/jobs/runner.js";
import { composeIdentity } from "../dist/use-cases/identity-messaging.js";

assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
const phase = process.argv[2],
  run = process.env.MANUAL_REHEARSAL_RUN ?? "";
assert.ok(["seed", "disabled", "produce", "worker", "read"].includes(phase));
assert.match(run, /^[a-f0-9]{32}$/);
const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise");
const connection = await mysql.createConnection(settingsFromEnvironment());
const [guard] = await connection.execute(
  "SELECT run_id,refs FROM synthetic_notification_guard WHERE id=1",
);
assert.equal(guard[0]?.run_id, run, "SYNTHETIC_NOTIFICATION_GUARD_REQUIRED");
const refs = typeof guard[0].refs === "string" ? JSON.parse(guard[0].refs) : guard[0].refs;
const unit = createUnitOfWork(settingsFromEnvironment());
const key = (purpose) =>
  createHash("sha256").update(`${run}:notifications:${purpose}`).digest("hex");
const password = "Fictional-manual-rehearsal-passphrase-42",
  origin = "http://127.0.0.1:4173";
const enabled = ["produce", "worker", "read"].includes(phase);
const composed = composeIdentity(
  unit,
  { secret: key("identity"), origin, production: false },
  undefined,
  { key: Buffer.from(key("admissions"), "hex").toString("base64url"), origin },
  false,
  ...(enabled
    ? [
        {
          production: false,
          synthetic: true,
          cursorKey: key("catalog"),
          maxFileBytes: 1048576,
          artifactTtlMs: 86400000,
          policyRevision: 1,
          evidence: [],
        },
        { cursorKey: key("trips") },
        undefined,
        { key: key("manual"), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
        { cursorKey: key("qualifications") },
        { cursorKey: key("events") },
        { key: key("reconciliation") },
        { key: key("decisions") },
        undefined,
        { cursorKey: key("notifications") },
      ]
    : [undefined, undefined, undefined, undefined, undefined, { cursorKey: key("events") }]),
);
const identity = composed.identity;
let step = "guard";
async function login(email) {
  const result = await identity.login(email, password);
  return identity.authenticate(
    new Headers({ cookie: result.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
  );
}
const email = (kind) => `notifications-${kind}-${run}@example.invalid`;
const denied = (e) => [1044, 1142, 1143, 1227].includes(e.errno);
async function submit(label) {
  const result = await composed.admissions.submit(`fixture-${label}`, newId(), {
    nickname: "Fictional Notification Applicant",
    email: `notification-${label}-${run}@example.invalid`,
    steamProfileUrl: "https://steamcommunity.com/id/fictional-notification-applicant",
    games: ["ets2"],
    discord: null,
    introduction: null,
  });
  assert.ok(result.id);
}
try {
  if (phase === "seed") {
    step = "seed_members";
    const ids = {};
    for (const kind of ["owner", "observer"]) {
      const id = newId(),
        credential = await identity.prepareCredential(password);
      await unit.run(async (tx) => {
        await identity.insertWithCredential(tx, {
          userId: id,
          email: email(kind),
          name: "Fictional Notification Member",
          ...credential,
          roles: ["driver"],
        });
        await createQualificationInitialization(unit).initialize(tx, {
          userId: id,
          games: ["ets2", "ats"],
          assignedAt: new Date().toISOString(),
        });
      });
      ids[kind] = id;
    }
    await connection.execute("UPDATE synthetic_notification_guard SET refs=? WHERE id=1", [
      JSON.stringify(ids),
    ]);
  } else if (phase === "disabled") {
    step = "base_role_disabled";
    assert.equal(composed.notifications, undefined);
    for (const statement of [
      "SELECT * FROM notifications",
      "SELECT * FROM notification_recipients",
      "SELECT * FROM outbox_routing",
      "SELECT * FROM outbox_routing_scans",
    ])
      await assert.rejects(connection.query(statement), denied);
    const director = await login("manual-rehearsal-director@example.invalid"),
      owner = await login(email("owner"));
    const target = await identity.getMember(director, refs.observer);
    const current = await connection.execute(
      "SELECT version FROM identity_memberships WHERE user_id=?",
      [Buffer.from(target.member.id)],
    );
    await identity.administer(director, refs.observer, newId(), Number(current[0][0].version), {
      kind: "roles",
      roles: ["driver", "dispatcher"],
    });
    await submit("disabled");
    const startsAt = new Date(Date.now() + 3600000).toISOString();
    const input = {
      title: "Fictional notification rehearsal",
      description: "Fictional description",
      game: "ets2",
      server: "Fictional server",
      organizer: "Fictional organizer",
      meetingLocation: "Fictional meeting",
      route: "Fictional route",
      meetingAt: new Date().toISOString(),
      startsAt,
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedMassKg: null,
      prescribedTrailerTypeId: null,
    };
    const created = await composed.events.create(director, newId(), input);
    await composed.events.respond(owner, created.data.event.id, newId(), 1, {
      response: "participating",
    });
  } else if (phase === "produce") {
    step = "runtime_enabled";
    const actor = await login(email("owner")),
      preferences = await composed.notifications.getPreferences(actor),
      command = newId();
    const first = await composed.notifications.setPreferences(
      actor,
      command,
      preferences.version,
      preferences.data,
    );
    assert.deepEqual(
      await composed.notifications.setPreferences(
        actor,
        command,
        preferences.version,
        preferences.data,
      ),
      first,
    );
    await submit("enabled");
    await assert.rejects(
      connection.query("UPDATE outbox_routing SET event_type=event_type"),
      denied,
    );
    await assert.rejects(connection.query("DELETE FROM outbox_routing"), denied);
  } else if (phase === "worker") {
    step = "worker_delivery";
    const service = composed.notifications;
    await service.maintenance();
    const queue = createQueue(
      unit,
      [service.handler, service.reminderHandler],
      [service.subscription],
      undefined,
      [
        "mail.deliver",
        "catalog.import",
        "manual.evidence-delete",
        "manual.generation-delete",
        "reconciliation.search",
        "trips.reevaluate",
      ],
    );
    await runPass(queue, new AbortController().signal);
    const [before] = await connection.query("SELECT COUNT(*) n FROM notifications");
    await runPass(queue, new AbortController().signal);
    const [after] = await connection.query("SELECT COUNT(*) n FROM notifications");
    assert.equal(Number(after[0].n), Number(before[0].n));
    for (const statement of [
      "CREATE TABLE forbidden_notification (id INT)",
      "UPDATE outbox_events SET schema_version=99",
      "DELETE FROM notifications",
      "UPDATE outbox_routing SET event_type=event_type",
    ])
      await assert.rejects(connection.query(statement), denied);
  } else {
    step = "runtime_read";
    const owner = await login(email("owner")),
      observer = await login(email("observer")),
      director = await login("manual-rehearsal-director@example.invalid");
    const own = await composed.notifications.poll(owner),
      other = await composed.notifications.poll(observer),
      admin = await composed.notifications.poll(director);
    assert.ok(own.items.some((r) => r.category === "event.reminder"));
    assert.ok(
      !other.items.some((r) => ["event.reminder", "application.submitted"].includes(r.category)),
    );
    assert.ok(admin.items.filter((r) => r.category === "application.submitted").length >= 2);
    const history = await composed.notifications.history(owner);
    assert.ok(history.items.every((r) => !r.liveToastEligible));
    const read = newId(),
      id = own.items.find((r) => r.category === "event.reminder").id;
    await composed.notifications.read(owner, id, read);
    await composed.notifications.read(owner, id, read);
    await composed.notifications.readThrough(owner, newId(), own.nextCursor);
    assert.equal((await composed.notifications.poll(owner)).unreadCount, 0);
    for (const statement of [
      "CREATE TABLE forbidden_notification (id INT)",
      "DELETE FROM notifications",
      "UPDATE notifications SET category='forbidden'",
      "UPDATE notification_commands SET result='{}'",
    ])
      await assert.rejects(connection.query(statement), denied);
  }
  console.log(JSON.stringify({ event: "notification_restricted_proof", phase, result: "pass" }));
} catch {
  console.error(
    JSON.stringify({ event: "notification_restricted_proof", phase, step, result: "fail" }),
  );
  throw Error("NOTIFICATION_RESTRICTED_PROOF_FAILED");
} finally {
  await connection.end();
  await unit.close();
}
