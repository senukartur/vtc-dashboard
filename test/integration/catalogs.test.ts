import { createHash, createHmac, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import {
  catalogArtifacts,
  catalogCommands,
  catalogFacts,
  catalogOperations,
  catalogPublications,
  catalogRevisions,
  eq,
} from "@vtc/db/catalogs-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { type CatalogConfig, hash, ordered } from "../../apps/api/src/modules/catalogs/artifact.ts";
import {
  type Catalogs,
  cleanupCatalogs,
  createCatalogs,
} from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { createQueue, LeaseLostError, type Queue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { catalogEvents, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";

const origin = "http://127.0.0.1:4173",
  password = "Fictional-catalog-passphrase-42";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const config: CatalogConfig = {
  production: false,
  synthetic: true,
  cursorKey: randomBytes(32).toString("hex"),
  maxFileBytes: 8 * 1024 * 1024,
  artifactTtlMs: 86400000,
  policyRevision: 1,
  evidence: [],
};
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  catalogs: Catalogs,
  director: Actor,
  cookie: string,
  queue: Queue;
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  catalogs = createCatalogs(unit, config, { identity, published: catalogEvents(unit).append });
  queue = createQueue(unit, [catalogs.handler]);
  await identity.bootstrap({
    email: "catalog-director@example.invalid",
    name: "Fictional Director",
    password,
  });
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  // Fixed fixture-owned DML keeps migrations separate from each behavior case.
  for (const table of [
    "job_effect_receipts",
    "durable_jobs",
    "outbox_events",
    "job_runner_leases",
    "catalog_mapping_reviews",
    "catalog_mapping_issues",
    "catalog_aliases",
    "catalog_relations",
    "catalog_mappings",
    "catalog_changes",
    "catalog_coverage",
    "catalog_facts",
    "catalog_entities",
    "catalog_publications",
    "catalog_revisions",
    "catalog_operations",
    "catalog_commands",
    "catalog_artifacts",
    "audit_entries",
    "identity_limits",
  ])
    await control.query(`DELETE FROM ${table}`);
  const login = await identity.login("catalog-director@example.invalid", password);
  cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie }));
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
async function status(input: Promise<unknown>) {
  try {
    await input;
    return 200;
  } catch (e) {
    return e && typeof e === "object" && "statusCode" in e ? Number(e.statusCode) : 500;
  }
}
async function start(a = artifact(), owner = catalogs) {
  const uploaded = await owner.upload(director, newId(), Buffer.from(JSON.stringify(a)));
  return owner.import(director, newId(), {
    artifactId: uploaded.id,
    sha256: uploaded.sha256,
    game: a.game,
  });
}
async function candidate(a = artifact(), owner = catalogs) {
  const op = await start(a, owner);
  await runPass(createQueue(unit, [owner.handler]), new AbortController().signal);
  const result = await owner.operation(director, op.id);
  expect(result.state).toBe("completed");
  expect(result.resultId).not.toBeNull();
  return result.resultId as string;
}
async function publish(id: string, owner = catalogs) {
  const r = await owner.detail(director, id);
  return owner.publish(director, id, newId(), r.version, {
    expectedPublicationVersion: r.publicationVersion,
    reason: "Fictional reviewed candidate",
  });
}
async function step(q = queue) {
  const token = await q.acquireRunner();
  if (!token) throw new Error("SYNTHETIC_RUNNER_BUSY");
  try {
    const claim = await q.claim(token);
    if (!claim) throw new Error("SYNTHETIC_CLAIM_MISSING");
    await q.execute(claim);
    return claim;
  } finally {
    await q.releaseRunner(token);
  }
}
const resolveInput = (revisionId: string, overrides: Record<string, unknown> = {}) => ({
  revisionId,
  game: "ats" as const,
  kind: "city" as const,
  mapNamespace: "base",
  provider: "synthetic",
  sourceId: null,
  locale: "en" as const,
  label: "Fictional city_one",
  regionId: null,
  ...overrides,
});

test("multibatch staging is durable, hidden, restartable and commits a complete immutable candidate", async () => {
  const a = artifact(
      "ats",
      Array.from({ length: 225 }, (_, i) => entity(`city_${i}`)),
    ),
    op = await start(a);
  await step();
  const [partial] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogOperations).where(eq(catalogOperations.id, op.id)),
  );
  expect(partial?.offset).toBe(100);
  expect(partial?.stagingRevisionId).not.toBeNull();
  expect(await status(catalogs.detail(director, partial?.stagingRevisionId as string))).toBe(404);
  expect((await catalogs.revisions(director, "ats", {})).items).toEqual([]);
  // A crash after a claimed chunk, before effect commit, is recovered by lease expiry.
  const runner = await queue.acquireRunner();
  expect(runner).not.toBeNull();
  const abandoned = await queue.claim(runner as string);
  expect(abandoned).not.toBeNull();
  await control.execute(
    "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
    [Buffer.from(abandoned?.id as string)],
  );
  await queue.releaseRunner(runner as string);
  await expect(queue.execute(abandoned as NonNullable<typeof abandoned>)).rejects.toBeInstanceOf(
    LeaseLostError,
  );
  const restarted = createQueue(unit, [catalogs.handler]);
  await runPass(restarted, new AbortController().signal);
  const completed = await catalogs.operation(director, op.id);
  expect(completed.state).toBe("completed");
  const [counts] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) count FROM catalog_facts WHERE revision_id=?",
    [Buffer.from(completed.resultId as string)],
  );
  expect(Number(counts[0]?.count)).toBe(225);
  const published = await publish(completed.resultId as string);
  expect(published.publicationVersion).toBe(2);
  const pages = await catalogs.entities(director, {
    revisionId: published.id,
    kind: "city",
    locale: "ru",
    limit: 100,
  });
  expect(pages.items).toHaveLength(100);
  expect(pages.nextCursor).not.toBeNull();
});
test("RU fallback preserves IDs, never creates aliases; exact source ID cannot be rescued by a matching label", async () => {
  const id = await candidate();
  await publish(id);
  const en = await catalogs.entities(director, { revisionId: id, kind: "city", locale: "en" }),
    ru = await catalogs.entities(director, { revisionId: id, kind: "city", locale: "ru" });
  expect(en.items.map((e) => e.id)).toEqual(ru.items.map((e) => e.id));
  expect(ru.items[0]?.display).toMatchObject({ renderedLocale: "en", englishFallback: true });
  expect(await catalogs.resolve(resolveInput(id, { sourceId: "unknown" }))).toMatchObject({
    status: "unknown",
    reasonCode: "unknown_source_id",
  });
  expect(
    await catalogs.resolve(resolveInput(id, { sourceId: "city_one", label: "wrong" })),
  ).toMatchObject({ status: "resolved" });
  expect(await catalogs.resolve(resolveInput(id, { locale: "ru" }))).toMatchObject({
    status: "unknown",
  });
  expect(
    await catalogs.resolve(resolveInput(id, { label: "  FICTIONAL   CITY_ONE " })),
  ).toMatchObject({ status: "resolved" });
});
test("exact MySQL identities preserve case, accents, NFC and trailing bytes independently of label search", async () => {
  const keys = ["A", "a", "é", "e", "e\u0301", "tail", "tail "],
    id = await candidate(
      artifact("ats", [
        ...keys.map((key) => entity(key)),
        ...Array.from({ length: 1000 }, (_, i) => entity(`bulk_${i}`)),
      ]),
    );
  await publish(id);
  const ids: string[] = [];
  for (const sourceId of keys) {
    const result = await catalogs.resolve(resolveInput(id, { sourceId }));
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") ids.push(result.entityId);
  }
  expect(new Set(ids).size).toBe(keys.length);
  const plans = [
    [
      "EXPLAIN SELECT entity_id FROM catalog_mappings WHERE revision_id=? AND provider=? AND game='ats' AND kind='city' AND map=? AND source_id=?",
      [Buffer.from(id), Buffer.from("synthetic"), Buffer.from("base"), Buffer.from("A")],
    ],
    [
      "EXPLAIN SELECT entity_id FROM catalog_aliases WHERE revision_id=? AND locale='en' AND normalized=?",
      [Buffer.from(id), Buffer.from("fictional a")],
    ],
    [
      "EXPLAIN SELECT entity_id FROM catalog_facts WHERE revision_id=? AND kind='city' AND retired=0 ORDER BY entity_id LIMIT 25",
      [Buffer.from(id)],
    ],
    [
      "EXPLAIN SELECT entity_id FROM catalog_changes WHERE revision_id=? ORDER BY entity_id LIMIT 25",
      [Buffer.from(id)],
    ],
  ] as const;
  for (const [query, values] of plans) {
    const [rows] = await control.query<RowDataPacket[]>(query, [...values]);
    expect(rows[0]?.key).not.toBeNull();
    expect(rows[0]?.type).not.toBe("ALL");
  }
});
test("same names across game/map/region resolve only with sufficient context", async () => {
  const regionA = entity("north", { kind: "region" }),
    regionB = entity("south", { kind: "region" });
  const cityA = entity("a", {
    labels: { en: "Shared", ru: "Общий" },
    regionKey: "north",
    aliases: [{ locale: "en", label: "Shared", regionKey: "north" }],
  });
  const cityB = entity("b", {
    labels: { en: "Shared", ru: null },
    regionKey: "south",
    aliases: [{ locale: "en", label: "Shared", regionKey: "south" }],
  });
  const map = entity("c", {
    mapNamespace: "other",
    aliases: [{ locale: "en", label: "Shared", regionKey: null }],
  });
  const id = await candidate(artifact("ats", [regionA, regionB, cityA, cityB, map]));
  await publish(id);
  expect(
    await catalogs.resolve(resolveInput(id, { label: "Shared", mapNamespace: null })),
  ).toMatchObject({ status: "ambiguous" });
  const regions = await catalogs.entities(director, {
    revisionId: id,
    kind: "region",
    locale: "en",
  });
  const north = regions.items.find((e) => e.display.label === "Fictional north")?.id;
  expect(
    await catalogs.resolve(resolveInput(id, { label: "Shared", regionId: north })),
  ).toMatchObject({ status: "resolved" });
  const ets = await candidate(
    artifact("ets2", [
      entity("a", { aliases: [{ locale: "en", label: "Shared", regionKey: null }] }),
    ]),
  );
  await publish(ets);
  expect(
    await catalogs.resolve(resolveInput(ets, { game: "ets2", label: "Shared" })),
  ).toMatchObject({ status: "resolved" });
});
test("region selectors filter identical labels before pagination and bind filter cursors", async () => {
  const data = artifact("ats", [
    entity("region_north", { kind: "region" }),
    entity("region_south", { kind: "region" }),
    ...Array.from({ length: 32 }, (_, i) =>
      entity(`north_${i}`, { regionKey: "region_north", labels: { en: "Shared", ru: "Общий" } }),
    ),
    entity("south_city", { regionKey: "region_south", labels: { en: "Shared", ru: null } }),
    entity("retired_city", {
      regionKey: "region_north",
      retired: true,
      labels: { en: "Shared", ru: null },
    }),
  ]);
  const id = await candidate(data);
  await publish(id);
  const regions = (
    await catalogs.entities(director, { revisionId: id, kind: "region", locale: "en" })
  ).items;
  const north = regions.find((r) => r.display.label === "Fictional region_north")?.id as string;
  const south = regions.find((r) => r.id !== north)?.id as string;
  const options = {
    revisionId: id,
    kind: "city",
    locale: "en" as const,
    regionId: north,
    search: "Sha",
    limit: 25,
  };
  const page = await catalogs.entities(director, options);
  expect(page.items).toHaveLength(25);
  expect(page.nextCursor).not.toBeNull();
  expect(page.items.every((e) => e.relatedEntityIds.includes(north) && !e.display.retired)).toBe(
    true,
  );
  expect(
    (await catalogs.entities(director, { ...options, cursor: page.nextCursor as string })).items,
  ).toHaveLength(7);
  expect(
    await status(
      catalogs.entities(director, {
        ...options,
        regionId: south,
        cursor: page.nextCursor as string,
      }),
    ),
  ).toBe(409);
  expect(
    (await catalogs.entities(director, { ...options, locale: "ru", search: "Об" })).items,
  ).toHaveLength(25);
  expect((await catalogs.entities(director, { ...options, regionId: newId() })).items).toEqual([]);
  const other = await candidate(artifact("ets2", [entity("other_region", { kind: "region" })]));
  await publish(other);
  const foreign = (
    await catalogs.entities(director, { revisionId: other, kind: "region", locale: "en" })
  ).items[0]?.id;
  expect(
    (await catalogs.entities(director, { ...options, regionId: foreign as string })).items,
  ).toEqual([]);
  const [plan] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT entity_id FROM catalog_facts WHERE revision_id=? AND kind='city' AND region_id=? AND retired=0 ORDER BY entity_id DESC LIMIT 26",
    [id, north],
  );
  expect(plan[0]?.possible_keys).toContain("catalog_selection_page");
  console.log(
    JSON.stringify({
      event: "catalog_query_plan",
      shape: "region_selector",
      access: plan[0]?.type,
      index: plan[0]?.key,
      rows: plan[0]?.rows,
    }),
  );
  const absentRegionRevision = await candidate(
    artifact("ats", [...data.entities, entity("later_region", { kind: "region" })]),
  );
  await publish(absentRegionRevision);
  const laterRegion = (
    await catalogs.entities(director, {
      revisionId: absentRegionRevision,
      kind: "region",
      locale: "en",
    })
  ).items.find((e) => e.display.label === "Fictional later_region")?.id;
  expect(
    (await catalogs.entities(director, { ...options, regionId: laterRegion as string })).items,
  ).toEqual([]);
});
test("DLC additions and explicit retirement preserve historical facts; missing sources never retire implicitly", async () => {
  const a = artifact(),
    first = await candidate(a);
  await publish(first);
  const before = await catalogs.entities(director, {
    revisionId: first,
    kind: "city",
    locale: "en",
  });
  const changed = structuredClone(a);
  const retiring = changed.entities[0];
  if (!retiring) throw new Error("SYNTHETIC_ENTITY_MISSING");
  retiring.retired = true;
  retiring.labels.en = "Renamed historical city";
  changed.packs.push({
    packId: "fictional_dlc",
    title: "Fictional DLC",
    state: "validated",
    contributionKinds: ["city"],
    provenance: [],
    reasonCodes: [],
  });
  changed.entities.push(entity("new", { packId: "fictional_dlc" }));
  const next = await candidate(changed);
  await publish(next);
  const old = before.items.find((e) => e.display.label === "Fictional city_one");
  expect(old).toBeDefined();
  if (!old) throw new Error("SYNTHETIC_ENTITY_MISSING");
  expect((await catalogs.entity(director, old?.id, first, "en")).display.retired).toBe(false);
  expect((await catalogs.entity(director, old?.id, next, "en")).display.retired).toBe(true);
  expect(
    (
      await catalogs.entities(director, { revisionId: next, kind: "city", locale: "en" })
    ).items.some((e) => e.id === old?.id),
  ).toBe(false);
  const incomplete = await start(artifact());
  await runPass(queue, new AbortController().signal);
  expect(await catalogs.operation(director, incomplete.id)).toMatchObject({
    state: "failed",
    failureCode: "omitted_historical_entity",
  });
  const [p] = await unit.run((tx) => unit.client(tx).select().from(catalogPublications));
  expect(p?.revisionId).toBe(next);
});
test("concurrent idempotency commits one upload/import and rejects changed payload; hash mismatches are rejected", async () => {
  const bytes = Buffer.from(JSON.stringify(artifact())),
    key = newId();
  const [a, b] = await Promise.all([
    catalogs.upload(director, key, bytes),
    catalogs.upload(director, key, bytes),
  ]);
  expect(a).toEqual(b);
  const [saved] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogCommands).where(eq(catalogCommands.key, key)),
  );
  expect(saved?.fingerprint).toEqual(
    createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
      .update("catalogs/command/v1\0")
      .update(ordered([director.userId, "upload", a.sha256]))
      .digest(),
  );
  expect(
    await status(catalogs.upload(director, key, Buffer.from(JSON.stringify(artifact("ets2"))))),
  ).toBe(409);
  const input = { artifactId: a.id, sha256: a.sha256, game: "ats" as const },
    importKey = newId();
  const [one, two] = await Promise.all([
    catalogs.import(director, importKey, input),
    catalogs.import(director, importKey, input),
  ]);
  expect(one).toEqual(two);
  expect(
    await status(catalogs.import(director, newId(), { ...input, sha256: "b".repeat(64) })),
  ).toBe(409);
});
test("missing packs, untrusted permission/English review and unresolved mapping issues block publication", async () => {
  const missing = artifact();
  missing.packs.push({
    packId: "missing",
    title: "Fictional missing DLC",
    state: "missing",
    contributionKinds: [],
    provenance: [],
    reasonCodes: ["source_missing"],
  });
  const missingId = await candidate(missing);
  expect(await status(publish(missingId))).toBe(409);
  const english = artifact();
  const unlabelled = english.entities[0];
  if (!unlabelled) throw new Error("SYNTHETIC_ENTITY_MISSING");
  unlabelled.labels.en = null;
  const englishId = await candidate(english);
  expect(await status(publish(englishId))).toBe(409);
  const untrusted = createCatalogs(
    unit,
    { ...config, synthetic: false, production: true },
    { identity, published: catalogEvents(unit).append },
  );
  const real = { ...artifact(), synthetic: false },
    realId = await candidate(real, untrusted);
  expect((await untrusted.review(director, realId)).sourceReviewState).toBe("pending");
  expect(await status(publish(realId, untrusted))).toBe(409);
  const issue = artifact();
  issue.mappingIssues.push({
    provider: "other",
    kind: "city",
    mapNamespace: "base",
    sourceId: "unknown",
    sourceLocale: "en",
    reasonCode: "ambiguous_source",
    candidateKeys: ["city_one", "city_two"],
  });
  const id = await candidate(issue);
  expect((await catalogs.review(director, id)).mappingIssues).toBe(1);
  const issues = await catalogs.reviewPage(director, id, "mapping-issues", { reviewVersion: 1 });
  expect(issues.items).toHaveLength(1);
  expect(await status(publish(id))).toBe(409);
  const [fact] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogFacts).where(eq(catalogFacts.revisionId, id)),
  );
  if (!fact) throw new Error("SYNTHETIC_FACT_MISSING");
  await catalogs.mapping(director, newId(), {
    catalogRevisionId: id,
    provider: "other",
    game: "ats",
    mapNamespace: "base",
    sourceId: "unknown",
    entityId: fact?.entityId,
    reason: "Fictional reviewed source",
  });
  expect((await catalogs.review(director, id)).mappingIssues).toBe(0);
  expect((await catalogs.review(director, id)).sourceReviewState).toBe("approved");
  expect((await catalogs.detail(director, id)).sourceReviewComplete).toBe(true);
  expect(await status(catalogs.reviewPage(director, id, "diff", { reviewVersion: 1 }))).toBe(409);
  await publish(id);
});

test("synthetic-enabled configuration cannot approve mapping edits to a reviewed real artifact", async () => {
  const real = { ...artifact(), synthetic: false };
  real.provenance.push({
    referenceId: newId(),
    publicSourceUrl: "https://example.invalid/catalog-source",
    attribution: "Fictional source for an isolated trust-boundary fixture",
    permittedUseBasis: "Synthetic test evidence only",
    observedAt: "2026-10-20T00:00:00.000Z",
  });
  const owner = createCatalogs(
    unit,
    {
      ...config,
      evidence: [
        {
          artifactSha256: hash(Buffer.from(JSON.stringify(real))),
          game: real.game,
          gameBuild: real.gameBuild,
          releaseInventoryAsOf: real.releaseInventoryAsOf,
          expectedPacks: real.packs.map((pack) => pack.packId),
          provenance: real.provenance,
          englishLabelsReviewed: true,
        },
      ],
    },
    { identity, published: catalogEvents(unit).append },
  );
  const id = await candidate(real, owner);
  expect((await owner.review(director, id)).sourceReviewState).toBe("approved");
  expect((await owner.detail(director, id)).sourceReviewComplete).toBe(true);
  const [fact] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogFacts).where(eq(catalogFacts.revisionId, id)),
  );
  if (!fact) throw new Error("SYNTHETIC_FACT_MISSING");
  await owner.mapping(director, newId(), {
    catalogRevisionId: id,
    provider: "other",
    game: real.game,
    mapNamespace: "base",
    sourceId: "new-unreviewed-mapping",
    entityId: fact.entityId,
    reason: "Fictional mapping edit beyond the reviewed artifact",
  });
  expect((await owner.review(director, id)).sourceReviewState).toBe("pending");
  expect((await owner.detail(director, id)).sourceReviewComplete).toBe(false);
  expect(await status(publish(id, owner))).toBe(409);
  const [pointer] = await unit.run((tx) => unit.client(tx).select().from(catalogPublications));
  expect(pointer?.revisionId).toBeNull();
});
test("two publishers serialize pointer guards; readers pin one revision and rollback includes pointer/audit/outbox", async () => {
  const one = await candidate(),
    two = await candidate();
  const commands = [publish(one), publish(two)];
  const outcomes = await Promise.allSettled(commands);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const [p] = await unit.run((tx) => unit.client(tx).select().from(catalogPublications));
  expect(p?.version).toBe(2);
  const current = p?.revisionId as string,
    pinned = await catalogs.entities(director, { revisionId: current, kind: "city", locale: "en" });
  expect(pinned.items.every((e) => e.revisionId === current)).toBe(true);
  const next = await candidate(),
    failing = createCatalogs(unit, config, {
      identity,
      async published(tx, event) {
        await catalogEvents(unit).append(tx, event);
        throw new Error("SYNTHETIC_POST_OUTBOX_FAILURE");
      },
    });
  expect(await status(publish(next, failing))).toBe(500);
  const [after] = await unit.run((tx) => unit.client(tx).select().from(catalogPublications));
  expect(after).toEqual(p);
  const [counts] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM audit_entries WHERE operation='catalog.published') audits, (SELECT COUNT(*) FROM outbox_events WHERE type='catalog.published') events",
  );
  expect(Number(counts[0]?.audits)).toBe(1);
  expect(Number(counts[0]?.events)).toBe(1);
});
test("revision discovery is current-first even when an older draft publishes; publication invalidates list cursors", async () => {
  const first = await candidate();
  await publish(first);
  const older = await candidate();
  await candidate();
  await publish(older);
  const page = await catalogs.revisions(director, "ats", { limit: 1 });
  expect(page.items[0]?.id).toBe(older);
  expect(page.nextCursor).not.toBeNull();
  const history = await catalogs.revisions(director, "ats", {
    limit: 1,
    cursor: page.nextCursor as string,
  });
  expect(history.items[0]?.id).toBe(first);
  const next = await candidate();
  await publish(next);
  expect(
    await status(
      catalogs.revisions(director, "ats", { limit: 1, cursor: page.nextCursor as string }),
    ),
  ).toBe(409);
  expect(
    (await catalogs.entities(director, { revisionId: older, kind: "city", locale: "en" })).items,
  ).toHaveLength(2);
});
test("semantic diff ignores ordering but records normalized alias changes separately from labels", async () => {
  const a = artifact();
  const initial = a.entities[0];
  if (!initial) throw new Error("SYNTHETIC_ENTITY_MISSING");
  initial.aliases = [{ locale: "en", label: "ru", regionKey: null }];
  const first = await candidate(a);
  await publish(first);
  const reordered = structuredClone(a);
  reordered.entities.reverse();
  const same = await candidate(reordered);
  expect((await catalogs.review(director, same)).changedEntities).toBe(0);
  const alias = structuredClone(a);
  const edited = alias.entities[0];
  if (!edited) throw new Error("SYNTHETIC_ENTITY_MISSING");
  edited.aliases = [{ locale: "ru", label: "en", regionKey: null }];
  const changed = await candidate(alias),
    review = await catalogs.review(director, changed);
  expect(review.changedEntities).toBe(1);
  const diff = await catalogs.reviewPage(director, changed, "diff", {
    reviewVersion: review.version,
  });
  expect(diff.items[0]).toMatchObject({ reasonCodes: ["aliases_changed"] });
});
test("preparation failure is durable, expiry cleanup keeps publication stable and removes incomplete rows", async () => {
  const current = await candidate();
  await publish(current);
  const op = await start(
    artifact(
      "ats",
      Array.from({ length: 205 }, (_, i) => entity(`extra_${i}`)),
    ),
  );
  await step();
  await step();
  await step();
  await step();
  const failing = createQueue(unit, [
    {
      ...catalogs.handler,
      prepare: async () => {
        throw new Error("SYNTHETIC_PREPARATION_FAILURE");
      },
    },
  ]);
  await step(failing);
  expect(await catalogs.operation(director, op.id)).toMatchObject({
    state: "failed",
    failureCode: "import_processing_failed",
  });
  await cleanupCatalogs(unit);
  await cleanupCatalogs(unit);
  const [operation] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogOperations).where(eq(catalogOperations.id, op.id)),
  );
  expect(operation?.state).toBe("failed");
  const [p] = await unit.run((tx) => unit.client(tx).select().from(catalogPublications));
  expect(p?.revisionId).toBe(current);
  const [r] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(catalogRevisions)
      .where(eq(catalogRevisions.id, operation?.stagingRevisionId as string)),
  );
  expect(r?.complete).toBe(false);
  expect(r?.state).toBe("rejected");
  await cleanupCatalogs(unit, () => new Date(Date.now() + 2 * 86400000));
  const [a] = await unit.run((tx) => unit.client(tx).select().from(catalogArtifacts));
  expect(a?.content).toBeNull();
});
test("current authority defeats stale actors after revocation and deputy demotion; denied HTTP never parses private upload", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/admin/catalog-import-policy" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/catalog-import-artifacts",
          headers: {
            cookie,
            origin: "https://example.invalid",
            "content-type": "multipart/form-data; boundary=fixture",
          },
          payload: "malformed",
        })
      ).statusCode,
    ).toBe(403);
    const id = await candidate();
    await control.execute(
      "UPDATE identity_memberships SET access_epoch=access_epoch+1 WHERE user_id=?",
      [Buffer.from(director.userId)],
    );
    expect(await status(catalogs.detail(director, id))).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/admin/catalog-revisions/${id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});
test("director/deputy parity is additive; ordinary member/dispatcher cannot administer and a demoted deputy loses authority", async () => {
  const id = await candidate();
  const credential = await identity.prepareCredential(password);
  for (const role of ["driver", "dispatcher", "deputy_director"] as const) {
    const userId = newId(),
      email = `${userId}@example.invalid`;
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email,
        name: "Fictional Role Fixture",
        ...credential,
        roles: [role],
      }),
    );
    const login = await identity.login(email, password),
      actor = await identity.authenticate(
        new Headers({ cookie: login.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
      );
    expect(await status(catalogs.revisions(actor, "ats", {}))).toBe(200);
    expect(await status(catalogs.detail(actor, id))).toBe(role === "deputy_director" ? 200 : 403);
    if (role === "deputy_director") {
      const published = await catalogs.publish(actor, id, newId(), 1, {
        expectedPublicationVersion: 1,
        reason: "Fictional deputy publication",
      });
      expect(published.state).toBe("published");
      await identity.administer(director, userId, newId(), 1, { kind: "roles", roles: ["driver"] });
      expect([401, 403]).toContain(await status(catalogs.detail(actor, id)));
    }
  }
});
test("wire-valid 128-scalar exact mapping keys accept multibyte Unicode and reject invalid surrogate data safely", async () => {
  const id = await candidate(),
    [f] = await unit.run((tx) =>
      unit.client(tx).select().from(catalogFacts).where(eq(catalogFacts.revisionId, id)),
    );
  if (!f) throw new Error("SYNTHETIC_FACT_MISSING");
  const input = {
    catalogRevisionId: id,
    provider: "漢".repeat(128),
    mapNamespace: "base",
    sourceId: "🚛".repeat(128),
    game: "ats" as const,
    entityId: f.entityId,
    reason: "Fictional unicode source review",
  };
  expect(await status(catalogs.mapping(director, newId(), input))).toBe(200);
  expect(await status(catalogs.mapping(director, newId(), { ...input, sourceId: "\ud800" }))).toBe(
    422,
  );
  await publish(id);
  expect(
    await catalogs.resolve(
      resolveInput(id, { provider: input.provider, sourceId: input.sourceId }),
    ),
  ).toMatchObject({ status: "resolved", entityId: f.entityId });
});
test("typed ADR/body/chain/region relations and exact unit mass remain pinned without shipment/coordinate inference", async () => {
  const data = artifact("ats", [
    entity("region", { kind: "region" }),
    entity("adr", { kind: "adr_category" }),
    entity("body", { kind: "trailer_body_type" }),
    entity("chain", { kind: "trailer_chain_type" }),
    entity("cargo", {
      kind: "cargo",
      cargoUnitMassKg: "0.000000000000000001",
      adrCategoryKey: "adr",
    }),
    entity("trailer", {
      kind: "trailer_type",
      trailerBodyTypeKey: "body",
      trailerChainTypeKey: "chain",
    }),
    entity("city", { regionKey: "region" }),
  ]);
  const id = await candidate(data);
  await publish(id);
  const resolved = await catalogs.resolve({
    ...resolveInput(id, { sourceId: "cargo" }),
    kind: "cargo",
  });
  if (resolved.status !== "resolved") throw new Error("SYNTHETIC_CARGO_MISSING");
  const fact = await catalogs.pinnedFact({
    revisionId: id,
    factRevisionId: resolved.factRevisionId,
  });
  expect(fact.cargoUnitMassKg).toBe("0.000000000000000001");
  expect(fact.adrCategoryId).not.toBeNull();
  expect(Object.keys(fact)).not.toContain("cargoMassKg");
  expect(Object.keys(fact)).not.toContain("latitude");
  await expect(
    control.execute(
      "UPDATE catalog_facts SET cargo_unit_mass_kg=1 WHERE revision_id=? AND kind='city'",
      [Buffer.from(id)],
    ),
  ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  await expect(
    control.execute(
      "UPDATE catalog_relations SET target_kind='city' WHERE revision_id=? AND relation='region'",
      [Buffer.from(id)],
    ),
  ).rejects.toBeDefined();
});
test("HTTP uses the existing ETag/envelopes and bounded strict multipart; unsupported/private fields never persist", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    const csrf = csrfProtection(identityConfig).issue({}, director).token,
      headers = {
        cookie,
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": newId(),
        "content-type": "multipart/form-data; boundary=synthetic",
      };
    const body = (data: string, extra = "") =>
      `--synthetic\r\nContent-Disposition: form-data; name="file"; filename="fixture.json"\r\nContent-Type: application/json\r\n\r\n${data}\r\n${extra}--synthetic--\r\n`;
    const valid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers,
      payload: body(JSON.stringify(artifact())),
    });
    expect(valid.statusCode).toBe(202);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: { ...headers, "idempotency-key": newId() },
      payload: body(JSON.stringify({ ...artifact(), privatePath: "nonfunctional-placeholder" })),
    });
    expect(invalid.statusCode).toBe(422);
    const extra = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: { ...headers, "idempotency-key": newId() },
      payload: body(
        JSON.stringify(artifact()),
        '--synthetic\r\nContent-Disposition: form-data; name="extra"\r\n\r\nignored\r\n',
      ),
    });
    expect([413, 422]).toContain(extra.statusCode);
    const id = await candidate(),
      read = await app.inject({
        method: "GET",
        url: `/api/v1/admin/catalog-revisions/${id}/review`,
        headers: { cookie },
      });
    expect(read.statusCode).toBe(200);
    expect(read.headers.etag).toBe('"v1"');
    expect(read.headers["cache-control"]).toBe("no-store");
    const precondition = await app.inject({
      method: "POST",
      url: `/api/v1/admin/catalog-revisions/${id}/publication`,
      headers: { cookie, origin, "x-csrf-token": csrf, "idempotency-key": newId() },
      payload: { expectedPublicationVersion: 1, reason: "Fictional" },
    });
    expect(precondition.statusCode).toBe(428);
  } finally {
    await app.close();
  }
});
test("large multipart preserves exact bytes and replay while enforcing streamed framing and file limits", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  const csrf = csrfProtection(identityConfig).issue({}, director).token;
  const raw = Buffer.from(
    JSON.stringify(
      artifact(
        "ats",
        Array.from({ length: 400 }, (_, i) => entity(`fictional_large_${i}`)),
      ),
    ),
  );
  expect(raw.length).toBeGreaterThan(65536);
  expect(raw.length).toBeLessThan(config.maxFileBytes);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const body = (bytes: Buffer) =>
    Buffer.concat([
      Buffer.from(
        '--synthetic-large\r\nContent-Disposition: form-data; name="file"; filename="fictional.json"\r\nContent-Type: application/json\r\n\r\n',
      ),
      bytes,
      Buffer.from("\r\n--synthetic-large--\r\n"),
    ]);
  const headers = (key: string) => ({
    cookie,
    origin,
    "x-csrf-token": csrf,
    "idempotency-key": key,
    "content-type": "multipart/form-data; boundary=synthetic-large",
  });
  try {
    const key = newId(),
      request = () =>
        app.inject({
          method: "POST",
          url: "/api/v1/admin/catalog-import-artifacts",
          headers: headers(key),
          payload: body(raw),
          signal: AbortSignal.timeout(12000),
        });
    const first = await request(),
      replay = await request();
    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data).toEqual(first.json().data);
    expect(first.json().data).toMatchObject({ sha256, byteLength: raw.length });
    const concurrentKey = newId(),
      simultaneous = await Promise.all(
        [0, 1].map(() =>
          app.inject({
            method: "POST",
            url: "/api/v1/admin/catalog-import-artifacts",
            headers: headers(concurrentKey),
            payload: body(raw),
            signal: AbortSignal.timeout(12000),
          }),
        ),
      );
    expect(simultaneous.map((r) => r.statusCode)).toEqual([202, 202]);
    expect(simultaneous[0]?.json().data).toEqual(simultaneous[1]?.json().data);
    expect(simultaneous[0]?.json().data).toMatchObject({ sha256, byteLength: raw.length });
    const retained = await unit.run((tx) => unit.client(tx).select().from(catalogArtifacts));
    expect(retained.length).toBe(2);
    expect(
      retained.every(
        (row) =>
          row.content === raw.toString() &&
          row.sha256.toString("hex") === sha256 &&
          row.byteLength === raw.length,
      ),
    ).toBe(true);
  } finally {
    await app.close();
  }
  const limit = 32768;
  const limited = createCatalogs(
    unit,
    { ...config, maxFileBytes: limit },
    { identity, published: catalogEvents(unit).append },
  );
  const limitedApp = await createApp({
    identity,
    catalogs: limited,
    checkReadiness: async () => true,
  });
  try {
    const fileLimit = await limitedApp.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: headers(newId()),
      payload: body(Buffer.alloc(limit + 1, 32)),
      signal: AbortSignal.timeout(12000),
    });
    expect(fileLimit.statusCode).toBe(413);
    // A streamed preamble has no Content-Length and exceeds the aggregate bound
    // before any valid file. Its bytes are not covered by the per-file limit.
    const preamble = Buffer.alloc(limit + 16385, 112),
      valid = body(Buffer.from(JSON.stringify(artifact())));
    const streamed = await limitedApp.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: { ...headers(newId()), "transfer-encoding": "chunked" },
      payload: Readable.from([preamble, Buffer.from("\r\n"), valid]),
      signal: AbortSignal.timeout(12000),
    });
    expect(streamed.statusCode).toBe(413);
    const retained = await unit.run((tx) => unit.client(tx).select().from(catalogArtifacts));
    expect(retained.length).toBe(2);
  } finally {
    await limitedApp.close();
  }
});

test("unknown COMMIT is surfaced without callback replay", async () => {
  const id = await candidate(),
    realEvents = catalogEvents(unit);
  let attempts = 0;
  const uncertain: UnitOfWork = {
    ...unit,
    run: async (command) => {
      attempts++;
      await unit.run(command);
      throw new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_ACK_LOSS"));
    },
  };
  const owner = createCatalogs(uncertain, config, { identity, published: realEvents.append });
  await expect(
    owner.publish(director, id, newId(), 1, {
      expectedPublicationVersion: 1,
      reason: "Fictional uncertainty",
    }),
  ).rejects.toBeInstanceOf(TransactionCommitOutcomeUnknownError);
  expect(attempts).toBe(1);
  expect((await catalogs.detail(director, id)).state).toBe("published");
});
