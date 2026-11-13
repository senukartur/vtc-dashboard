import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createUnitOfWork, newId, settingsFromEnvironment } from "@vtc/db";
import { createApp } from "../dist/app.js";
import { createCatalogs } from "../dist/modules/catalogs/service.js";
import { createEvents } from "../dist/modules/events/service.js";
import { createIdentity } from "../dist/modules/identity/service.js";

const phase = process.argv[2];
const proof = process.env.MANUAL_REHEARSAL_RUN;
const origin = "http://127.0.0.1:4173";
const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise");
const tables = ["event_metadata", "event_drafts", "event_draft_dlcs", "event_workflow_commands"];
const key = () => randomBytes(32).toString("hex");
const denied = (error) => [1044, 1142, 1143, 1227].includes(error.errno);
let unit, app, connection;
try {
  assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
  assert.match(proof, /^[a-f0-9]{32}$/);
  assert.ok(["route-only", "drafts", "jobs"].includes(phase));
  assert.equal(await readFile("/app/private-evidence/.manual-rehearsal-guard", "utf8"), proof);
  const settings = settingsFromEnvironment();
  assert.equal(settings.user, phase === "jobs" ? "vtc_jobs" : "vtc_runtime");
  connection = await mysql.createConnection(settings);
  const [guard] = await connection.query("SELECT run_id FROM synthetic_manual_guard WHERE id=1");
  assert.equal(guard[0]?.run_id, proof);
  if (phase !== "drafts")
    for (const table of tables)
      await assert.rejects(connection.query(`SELECT * FROM ${table} WHERE FALSE`), denied);
  if (phase === "drafts") {
    for (const statement of [
      "UPDATE event_metadata SET media_version=media_version WHERE FALSE",
      "DELETE FROM event_metadata WHERE FALSE",
      "UPDATE event_drafts SET event_id=event_id WHERE FALSE",
      "DELETE FROM event_drafts WHERE FALSE",
      "UPDATE event_draft_dlcs SET game=game WHERE FALSE",
      "UPDATE event_workflow_commands SET result=result WHERE FALSE",
      "DELETE FROM event_workflow_commands WHERE FALSE",
      "UPDATE event_revisions SET category=category WHERE FALSE",
      "DELETE FROM event_revisions WHERE FALSE",
      "SELECT id FROM event_media WHERE FALSE",
    ])
      await assert.rejects(connection.query(statement), denied);
  }
  if (phase !== "jobs") {
    unit = createUnitOfWork(settings);
    const identity = createIdentity(unit, { secret: key(), origin, production: false });
    const catalogs = createCatalogs(unit, { cursorKey: key() }, { identity });
    const events = createEvents(
      unit,
      {
        cursorKey: key(),
        routeEnabled: true,
        draftsEnabled: phase === "drafts",
      },
      { identity, catalogs },
    );
    app = await createApp({ checkReadiness: async () => true, identity, catalogs, events });
    const login = await identity.login(
      "manual-rehearsal-director@example.invalid",
      "Fictional-manual-rehearsal-passphrase-42",
    );
    const cookie = login.cookies.map((part) => part.split(";", 1)[0]).join("; ");
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.headers["x-vtc-events-stage2"], "1");
    assert.equal(me.headers["x-vtc-events-drafts"], phase === "drafts" ? "1" : undefined);
    const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
    assert.equal(csrf.statusCode, 200);
    const admin = "/api/v1/admin/events";
    const headers = { cookie, origin, "x-csrf-token": csrf.json().data.token };
    async function request(method, path, status, payload, version, commandKey = newId()) {
      const response = await app.inject({
        method,
        url: path,
        headers: {
          ...headers,
          ...(method === "GET" ? {} : { "idempotency-key": commandKey }),
          ...(version ? { "if-match": `"v${version}"` } : {}),
        },
        ...(payload === undefined ? {} : { payload }),
      });
      assert.equal(
        response.statusCode,
        status,
        `EVENT_DRAFTS_REHEARSAL_HTTP_${method}_${status}_${response.statusCode}`,
      );
      return response;
    }
    const input = {
      title: "Fictional restricted rehearsal convoy",
      game: "ets2",
      platform: "truckersmp",
      organizerMemberId: me.json().data.member.id,
      server: "Fictional rehearsal",
      meetingAt: "2099-10-25T12:00:00.000Z",
      startsAt: "2099-10-25T13:00:00.000Z",
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedTrailerTypeId: null,
      prescribedMassKg: null,
      requiredDlcIds: [],
    };
    await request("GET", admin, 200);
    if (phase === "route-only") {
      await request("POST", admin, 201, input);
      await request("POST", admin, 422, { draft: true, title: input.title });
      await request("GET", `${admin}?period=drafts`, 404);
      await request("GET", `${admin}/drafts/${newId()}`, 404);
    } else {
      const createKey = newId();
      const sparse = { draft: true, title: input.title };
      const created = await request("POST", admin, 201, sparse, null, createKey);
      const { id } = created.json().data;
      assert.equal(created.headers.etag, '"v1"');
      const draft = `${admin}/drafts/${id}`;
      await request("GET", draft, 200);
      const routeInput = {
        ...input,
        originCityId: "11700000-0000-4000-8000-000000000001",
        originDepotId: "11700000-0000-4000-8000-000000000003",
        distanceKm: "0",
      };
      const updated = await request("PATCH", draft, 200, routeInput, 1);
      assert.equal(updated.headers.etag, '"v2"');
      const page = await request("GET", `${admin}?period=drafts`, 200);
      assert.ok(page.json().data.items.some((row) => row.id === id));
      const createReplay = await request("POST", admin, 201, sparse, null, createKey);
      assert.deepEqual(createReplay.json().data, created.json().data);
      const publishKey = newId();
      const publishPath = `${admin}/${id}/publication`;
      const published = await request("POST", publishPath, 200, {}, 2, publishKey);
      assert.equal(published.json().data.event.id, id);
      assert.equal(published.json().data.event.originDepot.id, routeInput.originDepotId);
      assert.equal(published.headers.etag, '"v1"');
      const replay = await request("POST", publishPath, 200, {}, 2, publishKey);
      assert.deepEqual(replay.json().data, published.json().data);
      await request("GET", draft, 404);
      const other = await request("POST", admin, 201, { draft: true });
      const discarded = await request(
        "DELETE",
        `${admin}/${other.json().data.id}`,
        200,
        undefined,
        1,
      );
      assert.equal(discarded.json().data.lifecycle, "discarded");
    }
  }
} catch (error) {
  const code = /^EVENT_DRAFTS_REHEARSAL_HTTP_[A-Z]+_\d{3}_\d{3}$/.test(error?.message)
    ? error.message
    : "EVENT_DRAFTS_REHEARSAL_ASSERTION";
  console.error(code);
  process.exitCode = 1;
} finally {
  await app?.close();
  await unit?.close();
  await connection?.end();
}
