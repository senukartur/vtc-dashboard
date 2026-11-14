import { createHmac, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { createUnitOfWork, newId, runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { structuralLevels } from "../../apps/api/src/modules/qualifications/initialization.ts";
import { createQualifications } from "../../apps/api/src/modules/qualifications/service.ts";
import { canonicalJson } from "../../apps/api/src/modules/sources/contracts/canonical.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  qualificationLadderPriorFolder,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";

const settings = guardedSettings();
const unit = createUnitOfWork(settings);
let control: Awaited<ReturnType<typeof testConnection>>;
const prefix = qualificationLadderPriorFolder();

beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  expect(await runMigrations(settings, { folder: await prefix })).toBe(31);
}, SCHEMA_SETUP_TIMEOUT_MS);
afterAll(async () => {
  await unit.close();
  await control?.end();
  const folder = await prefix;
  await rm(folder, { recursive: true, force: true });
});

test(
  "the prior schema upgrades canonical and evidence-only rows and replays a preserved command receipt",
  async () => {
    const identityConfig = {
      secret: randomBytes(32).toString("hex"),
      origin: "http://127.0.0.1:4173",
      production: false,
    };
    const instant = "2026-10-20T12:00:00.000Z";
    const identity = createIdentity(
      unit,
      identityConfig,
      { accessEvents: identityAccessEvents(unit) },
      () => new Date(instant),
    );
    const email = "fictional-ladder-upgrade@example.invalid";
    const password = "Fictional ladder upgrade passphrase 42";
    await identity.bootstrap({ email, name: "Fictional Ladder Upgrade Director", password });
    const signed = await identity.login(email, password);
    const cookie = signed.cookies.map((row) => row.split(";", 1)[0]).join("; ");
    const director = await identity.authenticate(new Headers({ cookie }));
    const evidenceOnlyUser = newId(),
      rollbackUser = newId();
    const credential = await identity.prepareCredential(password);
    await unit.run(async (tx) => {
      for (const userId of [evidenceOnlyUser, rollbackUser])
        await identity.insertWithCredential(tx, {
          userId,
          email: `${userId}@example.invalid`,
          name: "Fictional Upgrade Driver",
          ...credential,
          roles: ["driver"],
        });
    });
    await control.execute("UPDATE identity_memberships SET status='inactive' WHERE user_id=?", [
      evidenceOnlyUser,
    ]);
    const [first, second] = structuralLevels.ets2;
    const canonical = newId(),
      evidenceOnly = newId(),
      oldRule = newId();
    const renameKey = newId(),
      publishKey = newId();
    const name = "Fictional renamed pre-migration level";
    const oldInput = { rules: [], requiredTrips: 0, requiredDistanceM: "20.5" };
    const sqlTime = "2026-10-20 12:00:00.000";
    await control.execute(
      "INSERT INTO qualification_initial_assignments(id,user_id,game,level,assigned_at) VALUES (?,?,'ets2','trainee',?),(?,?,'ats','trainee',?)",
      [canonical, director.userId, sqlTime, evidenceOnly, evidenceOnlyUser, sqlTime],
    );
    await control.execute(
      "INSERT INTO qualification_assignments(id,user_id,game,level_id,assigned_at,purpose,reason) VALUES (?,?,'ets2',?,?,'initial','Fictional canonical evidence')",
      [canonical, director.userId, second, sqlTime],
    );
    await control.execute("UPDATE qualification_levels SET name=?,version=5 WHERE id=?", [
      name,
      first,
    ]);
    await control.execute(
      "INSERT INTO qualification_rule_versions(id,level_id,published_at,effective_at,rules,required_trips,required_distance_m,actor_id) VALUES (?,?,?,?,'[]',0,20.5,?)",
      [oldRule, first, sqlTime, sqlTime, director.userId],
    );
    const digest = (value: string) =>
      createHmac("sha256", identityConfig.secret).update(value).digest();
    const receiptData = {
      id: first,
      game: "ets2",
      code: "trainee",
      name,
      configured: true,
      ruleVersionId: oldRule,
      requiredTrips: 0,
      requiredDistanceM: "20.5",
    };
    for (const { operation, key, input, version } of [
      { operation: "rename", key: renameKey, input: { name }, version: 4 },
      { operation: "publish", key: publishKey, input: oldInput, version: 5 },
    ]) {
      await control.execute(
        "INSERT INTO identity_command_results(scope_hash,command_key,fingerprint,result,expires_at) VALUES (?,?,?,?,?)",
        [
          digest(`scope:${director.userId}:qualification:${operation}:${first}`),
          key,
          digest(`input:${canonicalJson({ expected: version - 1, input })}`),
          JSON.stringify({ data: { ...receiptData, version }, version }),
          "2026-10-21 12:00:00.000",
        ],
      );
    }
    const [original] = await control.query<RowDataPacket[]>(
      "SELECT CAST(id AS CHAR) id, CAST(user_id AS CHAR) userId, game, level, assigned_at FROM qualification_initial_assignments ORDER BY id",
    );
    const [ledger] = await control.query<RowDataPacket[]>(
      "SELECT version, hash, state FROM _vtc_migrations ORDER BY version",
    );
    expect(await runMigrations(settings)).toBe(1);
    expect(await runMigrations(settings)).toBe(0);
    const [upgraded] = await control.query<RowDataPacket[]>(
      "SELECT CAST(id AS CHAR) id, CAST(user_id AS CHAR) userId, game, level, assigned_at, CAST(level_id AS CHAR) levelId FROM qualification_initial_assignments ORDER BY id",
    );
    expect(upgraded.map(({ levelId: _levelId, ...row }) => row)).toEqual(original);
    expect(upgraded.find((row) => row.id === canonical)?.levelId).toBe(second);
    expect(upgraded.find((row) => row.id === evidenceOnly)?.levelId).toBe(structuralLevels.ats[0]);
    const [afterLedger] = await control.query<RowDataPacket[]>(
      "SELECT version, hash, state FROM _vtc_migrations ORDER BY version",
    );
    expect(afterLedger.slice(0, ledger.length)).toEqual(ledger);
    const legacyInsertId = newId();
    await control.execute(
      "INSERT INTO qualification_initial_assignments(id,user_id,game,level,assigned_at) VALUES (?,?,'ets2','trainee',?)",
      [legacyInsertId, rollbackUser, sqlTime],
    );
    const [legacyInsert] = await control.execute<RowDataPacket[]>(
      "SELECT level_id,level FROM qualification_initial_assignments WHERE id=?",
      [legacyInsertId],
    );
    expect(legacyInsert[0]).toMatchObject({ level_id: null, level: "trainee" });
    const service = createQualifications(
      unit,
      { cursorKey: randomBytes(32).toString("hex"), ladderEditsEnabled: true },
      {
        identity,
        trips: createTrips(unit, { cursorKey: randomBytes(32).toString("hex") }, { identity }),
      },
      () => new Date(instant),
    );
    const before = await service.ladder(director, "ets2");
    expect(before.data.levels[0]).toMatchObject({
      id: first,
      name,
      version: 5,
      position: 1,
      ruleVersionId: oldRule,
    });
    await service.changeLadder(director, "ets2", newId(), before.version, {
      type: "reorder",
      input: { levelIds: [second, first, ...structuralLevels.ets2.slice(2)] },
    });
    const current = (await service.ladder(director, "ets2")).data.levels.find(
      (row) => row.id === first,
    );
    if (!current) throw new Error("SYNTHETIC_LEVEL_MISSING");
    await service.rename(director, first, newId(), current.version, {
      name: "Fictional current name",
    });
    const rename = await service.rename(director, first, renameKey, 3, { name });
    const publication = await service.publish(director, first, publishKey, 4, oldInput);
    for (const [result, version] of [
      [rename, 4],
      [publication, 5],
    ] as const) {
      expect(result).toMatchObject({
        version,
        data: {
          id: first,
          game: "ets2",
          name,
          position: 1,
          ruleVersionId: oldRule,
          requiredTrips: 0,
          requiredDistanceM: "20.5",
        },
      });
      expect(result.data).not.toHaveProperty("code");
      expect(result.data.freightRuleSummary).toBeNull();
    }
    expect((await service.rules(director, first)).items).toHaveLength(1);
    expect((await service.ladder(director, "ets2")).data.levels[1]?.name).toBe(
      "Fictional current name",
    );
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);
