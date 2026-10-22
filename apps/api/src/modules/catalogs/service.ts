import { createHmac } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  newId,
  opaqueUtf8,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import {
  and,
  asc,
  catalogAliases,
  catalogArtifacts,
  catalogChanges,
  catalogCommands,
  catalogCoverage,
  catalogFacts,
  catalogMappingIssues,
  catalogMappingReviews,
  catalogMappings,
  catalogOperations,
  catalogPublications,
  catalogRelations,
  catalogRevisions,
  desc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "@vtc/db/catalogs-schema";
import { createQueue, retryTransaction } from "../../platform/jobs/queue.js";
import { duplicateKey } from "../../platform/outbox/events.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  type Artifact,
  aliasKey,
  type CatalogConfig,
  cursorCodec,
  type Game,
  hash,
  type Kind,
  kinds,
  mappingSummary,
  ordered,
  parseArtifact,
  semantic,
  validateCatalogConfig,
} from "./artifact.js";
import { createImportHandler } from "./importer.js";

type S = components["schemas"];
type Revision = typeof catalogRevisions.$inferSelect;
type Fact = typeof catalogFacts.$inferSelect;
type Page = { limit?: number; cursor?: string };

export interface CatalogPorts {
  identity: Pick<Identity, "authorizeInTransaction" | "onboardingCompany">;
  published(
    tx: TxContext,
    event: { eventId: string; revisionId: string; version: number; occurredAt: string },
  ): Promise<void>;
}
const keyBytes = (s: string) => {
  try {
    if ([...s].length > 128) throw new Error();
    return opaqueUtf8(s, 512);
  } catch {
    throw identityError(422);
  }
};
const digest = (s: unknown) => Buffer.from(hash(ordered(s)), "hex");
const match = (version: number, expected: number) => {
  if (version !== expected) throw identityError(409, "VERSION_CONFLICT");
};
const operationDto = (o: typeof catalogOperations.$inferSelect): S["Operation"] => ({
  id: o.id,
  state: o.state,
  resultId: o.resultId,
  failureCode: o.failureCode,
});
const artifactDto = (a: typeof catalogArtifacts.$inferSelect): S["CatalogArtifact"] => ({
  id: a.id,
  state: a.content === null ? "rejected" : "ready",
  sha256: a.sha256.toString("hex"),
  byteLength: a.byteLength,
});

export function createCatalogs(
  unit: UnitOfWork,
  config: CatalogConfig,
  ports: CatalogPorts,
  now = () => new Date(),
) {
  validateCatalogConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn),
    at = () => now().toISOString(),
    audit = createAudit(unit),
    cursors = cursorCodec(config.cursorKey);
  async function authority(tx: TxContext, actor: Actor, admin = true) {
    await ports.identity.authorizeInTransaction(
      tx,
      actor,
      admin ? "qualifications.manage" : "company.read",
    );
  }
  async function pointer(tx: TxContext, game: Game) {
    await c(tx)
      .insert(catalogPublications)
      .values({ game, version: 1, revisionId: null })
      .onDuplicateKeyUpdate({ set: { game } });
    const [row] = await c(tx)
      .select()
      .from(catalogPublications)
      .where(eq(catalogPublications.game, game))
      .for("update");
    if (!row) throw identityError(503);
    return row;
  }
  async function revision(tx: TxContext, id: string, lock = false) {
    const query = c(tx)
      .select()
      .from(catalogRevisions)
      .where(eq(catalogRevisions.id, applicationId(id)));
    const [row] = await (lock ? query.for("update") : query);
    if (!row?.complete) throw identityError(404);
    return row;
  }
  async function once<T>(
    tx: TxContext,
    actor: Actor,
    scope: string,
    key: string,
    input: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    const scopeHash = digest([actor.userId, scope]),
      fingerprint = createHmac("sha256", Buffer.from(config.cursorKey, "hex"))
        .update("catalogs/command/v1\0")
        .update(ordered([actor.userId, scope, input]))
        .digest();
    applicationId(key);
    const [saved] = await c(tx)
      .select()
      .from(catalogCommands)
      .where(and(eq(catalogCommands.scope, scopeHash), eq(catalogCommands.key, key)))
      .for("update");
    if (saved && saved.expiresAt > at()) {
      if (!saved.fingerprint.equals(fingerprint)) throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result as T;
    }
    if (saved)
      await c(tx)
        .delete(catalogCommands)
        .where(and(eq(catalogCommands.scope, scopeHash), eq(catalogCommands.key, key)));
    const result = await fn();
    await c(tx)
      .insert(catalogCommands)
      .values({
        scope: scopeHash,
        key,
        fingerprint,
        result,
        expiresAt: new Date(now().getTime() + config.artifactTtlMs).toISOString(),
      });
    return result;
  }
  async function revisionDto(tx: TxContext, r: Revision): Promise<S["CatalogRevision"]> {
    const [p] = await c(tx)
      .select()
      .from(catalogPublications)
      .where(eq(catalogPublications.game, r.game));
    const coverage = await c(tx)
      .select()
      .from(catalogCoverage)
      .where(eq(catalogCoverage.revisionId, r.id));
    const [missingLabel] = await c(tx)
      .select({ id: catalogFacts.id })
      .from(catalogFacts)
      .where(and(eq(catalogFacts.revisionId, r.id), sql`${catalogFacts.labelEn} IS NULL`))
      .limit(1);
    const edits = await c(tx)
      .select({ id: catalogMappingReviews.id })
      .from(catalogMappingReviews)
      .where(eq(catalogMappingReviews.revisionId, r.id))
      .limit(1);
    const source =
      trusted(r, coverage) &&
      (!edits.length || (r.synthetic && config.synthetic && !config.production));
    return {
      id: r.id,
      version: r.version,
      publicationVersion: p?.version ?? 1,
      game: r.game,
      state: r.state,
      createdAt: r.createdAt,
      coverageComplete:
        source && coverage.every((p) => ["validated", "non_contributing"].includes(p.state)),
      englishLabelsComplete: !missingLabel && source,
      sourceReviewComplete: source,
    };
  }
  function trusted(r: Revision, packs: (typeof catalogCoverage.$inferSelect)[]) {
    if (r.synthetic) return config.synthetic && !config.production;
    return config.evidence.some(
      (e) =>
        e.artifactSha256 === r.artifactSha256.toString("hex") &&
        e.game === r.game &&
        e.gameBuild === r.gameBuild &&
        e.releaseInventoryAsOf === r.inventoryAsOf &&
        semantic(e.expectedPacks) === semantic(packs.map((p) => p.packId.toString())) &&
        semantic(e.provenance) === semantic(r.provenance),
    );
  }
  function pageOptions(actor: Actor, binding: unknown, page: Page) {
    const limit = page.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
    const bound = [actor.userId, actor.sessionId, actor.accessEpoch, binding];
    let after: string | null = null;
    try {
      after = page.cursor ? cursors.read(bound, page.cursor) : null;
    } catch {
      throw identityError(409, "VERSION_CONFLICT");
    }
    return {
      limit,
      after,
      result: <T>(rows: T[], id: (row: T) => string) => ({
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? cursors.write(bound, id(rows[limit - 1] as T)) : null,
      }),
    };
  }
  function factDto(f: Fact, locale: "en" | "ru"): S["CatalogEntity"] {
    const text = locale === "ru" ? (f.labelRu ?? f.labelEn) : f.labelEn;
    if (!text) throw identityError(409);
    const renderedLocale = locale === "ru" && f.labelRu ? "ru" : "en";
    return {
      id: f.entityId,
      revisionId: f.revisionId,
      game: f.game,
      kind: f.kind,
      mapNamespace: f.map.toString(),
      display: {
        entityId: f.entityId,
        label: text,
        requestedLocale: locale,
        renderedLocale,
        englishFallback: renderedLocale !== locale,
        retired: f.retired,
      },
      relatedEntityIds: [
        f.regionId,
        f.adrCategoryId,
        f.trailerBodyTypeId,
        f.trailerChainTypeId,
      ].filter((v): v is string => v !== null),
    };
  }
  const handler = createImportHandler(unit, config, now);
  const producer = createQueue(unit, [handler]);
  async function resolveInTransaction(
    tx: TxContext,
    input: {
      revisionId: string;
      game: Game;
      kind: Kind;
      mapNamespace: string | null;
      provider: string;
      sourceId: string | null;
      locale: "en" | "ru" | null;
      label: string | null;
      regionId: string | null;
    },
  ) {
    const r = await revision(tx, input.revisionId);
    if (r.state !== "published" || r.game !== input.game)
      return { status: "unknown" as const, reasonCode: "catalog_unavailable" };
    let candidates: Fact[];
    const scope = and(
      eq(catalogFacts.revisionId, r.id),
      eq(catalogFacts.game, input.game),
      eq(catalogFacts.kind, input.kind),
      input.mapNamespace === null ? undefined : eq(catalogFacts.map, keyBytes(input.mapNamespace)),
      input.regionId === null
        ? undefined
        : eq(catalogFacts.regionId, applicationId(input.regionId)),
    );
    if (input.sourceId !== null) {
      const mappings = await c(tx)
        .select({ entityId: catalogMappings.entityId })
        .from(catalogMappings)
        .where(
          and(
            eq(catalogMappings.revisionId, r.id),
            eq(catalogMappings.game, input.game),
            eq(catalogMappings.kind, input.kind),
            eq(catalogMappings.provider, keyBytes(input.provider)),
            eq(catalogMappings.sourceId, keyBytes(input.sourceId)),
            input.mapNamespace === null
              ? undefined
              : eq(catalogMappings.map, keyBytes(input.mapNamespace)),
          ),
        );
      candidates = mappings.length
        ? await c(tx)
            .select()
            .from(catalogFacts)
            .where(
              and(
                scope,
                inArray(
                  catalogFacts.entityId,
                  mappings.map((m) => m.entityId),
                ),
              ),
            )
        : [];
    } else if (input.label !== null) {
      const aliases = await c(tx)
        .select({ entityId: catalogAliases.entityId })
        .from(catalogAliases)
        .where(
          and(
            eq(catalogAliases.revisionId, r.id),
            eq(catalogAliases.normalized, opaqueUtf8(aliasKey(input.label), 512)),
            input.locale === null ? undefined : eq(catalogAliases.locale, input.locale),
            input.regionId === null
              ? undefined
              : sql`(${catalogAliases.regionScope} = ${Buffer.from(input.regionId)} OR ${catalogAliases.regionScope} = ${Buffer.from("*")})`,
          ),
        );
      candidates = aliases.length
        ? await c(tx)
            .select()
            .from(catalogFacts)
            .where(
              and(
                scope,
                inArray(
                  catalogFacts.entityId,
                  aliases.map((a) => a.entityId),
                ),
              ),
            )
        : [];
    } else candidates = [];
    const unique = [...new Map(candidates.map((f) => [f.entityId, f])).values()];
    if (!unique.length)
      return {
        status: "unknown" as const,
        reasonCode: input.sourceId !== null ? "unknown_source_id" : "unknown_alias",
      };
    if (unique.length > 1)
      return {
        status: "ambiguous" as const,
        candidateIds: unique.map((f) => f.entityId).sort(),
      };
    const fact = unique[0] as Fact;
    return { status: "resolved" as const, entityId: fact.entityId, factRevisionId: fact.id };
  }

  return {
    config,
    handler,
    async authorize(actor: Actor, admin = true) {
      return run((tx) => authority(tx, actor, admin));
    },
    async policy(actor: Actor): Promise<S["UploadPolicy"]> {
      await run((tx) => authority(tx, actor));
      return {
        enabled: true,
        maxFileBytes: config.maxFileBytes,
        maxFilesPerReport: 1,
        allowedMimeTypes: ["application/json"],
        policyRevision: config.policyRevision,
      };
    },
    async upload(actor: Actor, key: string, bytes: Buffer): Promise<S["CatalogArtifact"]> {
      if (bytes.length > config.maxFileBytes) throw identityError(413);
      let a: Artifact;
      try {
        a = parseArtifact(bytes);
      } catch {
        throw identityError(422);
      }
      if (a.synthetic && (!config.synthetic || config.production)) throw identityError(422);
      const sha256 = hash(bytes);
      return run(async (tx) => {
        await authority(tx, actor);
        return once(tx, actor, "upload", key, sha256, async () => {
          const row = {
            id: newId(),
            creatorId: actor.userId,
            sha256: Buffer.from(sha256, "hex"),
            byteLength: bytes.length,
            content: bytes.toString(),
            payloadExpiresAt: new Date(now().getTime() + config.artifactTtlMs).toISOString(),
            createdAt: at(),
            expiresAt: new Date(now().getTime() + config.artifactTtlMs).toISOString(),
          };
          await c(tx).insert(catalogArtifacts).values(row);
          return artifactDto(row);
        });
      });
    },
    async artifact(actor: Actor, id: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        const [a] = await c(tx)
          .select()
          .from(catalogArtifacts)
          .where(eq(catalogArtifacts.id, applicationId(id)));
        if (!a || a.creatorId !== actor.userId) throw identityError(404);
        return artifactDto(a);
      });
    },
    async import(
      actor: Actor,
      key: string,
      input: S["CatalogImportInput"],
    ): Promise<S["Operation"]> {
      return run(async (tx) => {
        await authority(tx, actor);
        return once(tx, actor, "import", key, input, async () => {
          const [a] = await c(tx)
            .select()
            .from(catalogArtifacts)
            .where(eq(catalogArtifacts.id, input.artifactId))
            .for("share");
          if (!a || a.creatorId !== actor.userId) throw identityError(404);
          if (!a.content || a.expiresAt <= at() || a.sha256.toString("hex") !== input.sha256)
            throw identityError(409);
          const op = {
            id: newId(),
            creatorId: actor.userId,
            artifactId: a.id,
            game: input.game,
            state: "processing" as const,
            resultId: null,
            failureCode: null,
            stagingRevisionId: null,
            phase: "identities" as const,
            offset: 0,
            createdAt: at(),
          };
          await c(tx).insert(catalogOperations).values(op);
          await producer.enqueue(tx, {
            kind: handler.kind,
            schemaVersion: 1,
            consumer: handler.consumer,
            effectKey: op.id,
            eventId: null,
            reference: {
              operationId: op.id,
              artifactId: a.id,
              sha256: input.sha256,
              phase: "identities",
              offset: 0,
            },
            availableAt: at(),
            maxAttempts: 5,
          });
          return operationDto(op);
        });
      });
    },
    async operation(actor: Actor, id: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        const [op] = await c(tx)
          .select()
          .from(catalogOperations)
          .where(eq(catalogOperations.id, applicationId(id)));
        if (!op || op.creatorId !== actor.userId) throw identityError(404);
        const job =
          op.state === "processing"
            ? await producer.effectState(
                tx,
                handler.consumer,
                op.phase === "identities" && op.offset === 0
                  ? op.id
                  : `${op.id}:${op.phase}:${op.offset}`,
              )
            : undefined;
        return job?.state === "failed"
          ? {
              ...operationDto(op),
              state: "failed" as const,
              failureCode: "import_processing_failed",
            }
          : operationDto(op);
      });
    },
    async detail(actor: Actor, id: string) {
      return run(async (tx) => {
        await authority(tx, actor);
        return revisionDto(tx, await revision(tx, id));
      });
    },
    async revisions(actor: Actor, game: Game, page: Page) {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const [publication] = await c(tx)
          .select()
          .from(catalogPublications)
          .where(eq(catalogPublications.game, game));
        const p = pageOptions(
          actor,
          ["revisions", game, publication?.version ?? 1, publication?.revisionId ?? null],
          page,
        );
        const current =
          !p.after && publication?.revisionId ? await revision(tx, publication.revisionId) : null;
        const after =
          p.after && p.after !== "current" ? (JSON.parse(p.after) as [string, string]) : null;
        const rows = await c(tx)
          .select()
          .from(catalogRevisions)
          .where(
            and(
              eq(catalogRevisions.game, game),
              eq(catalogRevisions.state, "published"),
              publication?.revisionId
                ? sql`${catalogRevisions.id} <> ${Buffer.from(publication.revisionId)}`
                : undefined,
              after
                ? or(
                    lt(catalogRevisions.createdAt, after[0]),
                    and(
                      eq(catalogRevisions.createdAt, after[0]),
                      lt(catalogRevisions.id, after[1]),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(catalogRevisions.createdAt), desc(catalogRevisions.id))
          .limit(p.limit + 1);
        const result = p.result(current ? [current, ...rows] : rows, (r) =>
          r.id === publication?.revisionId ? "current" : JSON.stringify([r.createdAt, r.id]),
        );
        return { ...result, items: await Promise.all(result.items.map((r) => revisionDto(tx, r))) };
      });
    },
    async entities(
      actor: Actor,
      options: Page & {
        revisionId: string;
        kind: string;
        locale: "en" | "ru";
        search?: string;
        regionId?: string;
      },
    ) {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const r = await revision(tx, options.revisionId);
        if (r.state !== "published") throw identityError(404);
        if (!(kinds as readonly string[]).includes(options.kind)) throw identityError(422);
        const p = pageOptions(
          actor,
          [
            "entities",
            r.id,
            options.kind,
            options.locale,
            options.search ?? null,
            options.regionId ?? null,
          ],
          options,
        );
        const display =
          options.locale === "ru"
            ? sql`COALESCE(${catalogFacts.labelRu}, ${catalogFacts.labelEn})`
            : catalogFacts.labelEn;
        const escaped = options.search?.replace(/[\\%_]/g, (v) => `\\${v}`);
        const rows = await c(tx)
          .select()
          .from(catalogFacts)
          .where(
            and(
              eq(catalogFacts.revisionId, r.id),
              eq(catalogFacts.kind, options.kind as Kind),
              eq(catalogFacts.retired, false),
              options.regionId
                ? eq(catalogFacts.regionId, applicationId(options.regionId))
                : undefined,
              p.after ? lt(catalogFacts.entityId, p.after) : undefined,
              escaped ? sql`${display} LIKE ${`${escaped}%`}` : undefined,
            ),
          )
          .orderBy(desc(catalogFacts.entityId))
          .limit(p.limit + 1);
        const result = p.result(rows, (f) => f.entityId);
        return { ...result, items: result.items.map((f) => factDto(f, options.locale)) };
      });
    },
    async entity(actor: Actor, id: string, revisionId: string, locale: "en" | "ru") {
      return run(async (tx) => {
        await authority(tx, actor, false);
        const r = await revision(tx, revisionId);
        if (r.state !== "published") throw identityError(404);
        const [f] = await c(tx)
          .select()
          .from(catalogFacts)
          .where(
            and(eq(catalogFacts.revisionId, r.id), eq(catalogFacts.entityId, applicationId(id))),
          );
        if (!f) throw identityError(404);
        return factDto(f, locale);
      });
    },
    async review(actor: Actor, id: string): Promise<S["CatalogReview"]> {
      return run(async (tx) => {
        await authority(tx, actor);
        const r = await revision(tx, id),
          packs = await c(tx)
            .select()
            .from(catalogCoverage)
            .where(eq(catalogCoverage.revisionId, id)),
          changes = await c(tx)
            .select({ kind: catalogChanges.changeKind })
            .from(catalogChanges)
            .where(eq(catalogChanges.revisionId, id));
        return {
          revisionId: id,
          version: r.version,
          comparisonRevisionId: r.comparisonRevisionId,
          gameBuild: r.gameBuild,
          releaseInventoryAsOf: r.inventoryAsOf,
          addedEntities: changes.filter((x) => x.kind === "added").length,
          changedEntities: changes.filter((x) => x.kind === "changed").length,
          retiredEntities: changes.filter((x) => x.kind === "retired").length,
          expectedPacks: packs.length,
          validatedPacks: packs.filter((p) => p.state === "validated").length,
          missingPacks: packs.filter((p) => p.state === "missing").length,
          failedPacks: packs.filter((p) => p.state === "failed").length,
          nonContributingPacks: packs.filter((p) => p.state === "non_contributing").length,
          mappingIssues: Number(
            (
              await c(tx)
                .select({ count: sql<number>`COUNT(*)` })
                .from(catalogMappingIssues)
                .where(
                  and(
                    eq(catalogMappingIssues.revisionId, id),
                    eq(catalogMappingIssues.resolved, false),
                  ),
                )
            )[0]?.count ?? 0,
          ),
          sourceReviewState: (await revisionDto(tx, r)).sourceReviewComplete
            ? "approved"
            : "pending",
          provenance: r.provenance as S["CatalogProvenance"][],
        };
      });
    },
    async reviewPage(
      actor: Actor,
      id: string,
      lane: "diff" | "coverage" | "mapping-issues",
      options: Page & { reviewVersion: number; changeKind?: string },
    ) {
      return run(async (tx) => {
        await authority(tx, actor);
        const r = await revision(tx, id);
        match(r.version, options.reviewVersion);
        const p = pageOptions(actor, [lane, id, r.version, options.changeKind ?? null], options);
        if (lane === "mapping-issues") {
          const rows = await c(tx)
            .select()
            .from(catalogMappingIssues)
            .where(
              and(
                eq(catalogMappingIssues.revisionId, id),
                eq(catalogMappingIssues.resolved, false),
                p.after ? lt(catalogMappingIssues.id, p.after) : undefined,
              ),
            )
            .orderBy(desc(catalogMappingIssues.id))
            .limit(p.limit + 1);
          const result = p.result(rows, (issue) => issue.id);
          return {
            ...result,
            items: result.items.map((issue) => ({
              id: issue.id,
              provider: issue.provider.toString(),
              mapNamespace: issue.map.toString(),
              sourceId: issue.sourceId?.toString() ?? null,
              sourceLocale: issue.sourceLocale,
              reasonCode: issue.reasonCode,
              candidateEntityIds: issue.candidateEntityIds,
            })),
          };
        }
        if (lane === "coverage") {
          const rows = await c(tx)
            .select()
            .from(catalogCoverage)
            .where(
              and(
                eq(catalogCoverage.revisionId, id),
                p.after ? gt(catalogCoverage.packId, keyBytes(p.after)) : undefined,
              ),
            )
            .orderBy(asc(catalogCoverage.packId))
            .limit(p.limit + 1);
          const result = p.result(rows, (p) => p.packId.toString());
          return {
            ...result,
            items: result.items.map(({ revisionId: _, ...pack }) => ({
              ...pack,
              packId: pack.packId.toString(),
            })),
          };
        }
        const rows = await c(tx)
          .select()
          .from(catalogChanges)
          .where(
            and(
              eq(catalogChanges.revisionId, id),
              options.changeKind
                ? eq(catalogChanges.changeKind, options.changeKind as "added")
                : undefined,
              p.after ? lt(catalogChanges.entityId, p.after) : undefined,
            ),
          )
          .orderBy(desc(catalogChanges.entityId))
          .limit(p.limit + 1);
        const result = p.result(rows, (f) => f.entityId);
        return { ...result, items: result.items.map(({ revisionId: _, ...change }) => change) };
      });
    },
    async mapping(actor: Actor, key: string, input: S["CatalogMappingInput"]) {
      return run(async (tx) => {
        await authority(tx, actor);
        return once(tx, actor, "mapping", key, input, async () => {
          const r = await revision(tx, input.catalogRevisionId, true);
          if (r.state !== "draft" || r.game !== input.game) throw identityError(409);
          const [f] = await c(tx)
            .select()
            .from(catalogFacts)
            .where(
              and(
                eq(catalogFacts.revisionId, r.id),
                eq(catalogFacts.entityId, input.entityId),
                eq(catalogFacts.map, keyBytes(input.mapNamespace)),
              ),
            );
          if (!f) throw identityError(422);
          try {
            await c(tx)
              .insert(catalogMappings)
              .values({
                revisionId: r.id,
                game: r.game,
                kind: f.kind,
                map: f.map,
                provider: keyBytes(input.provider),
                sourceId: keyBytes(input.sourceId),
                entityId: f.entityId,
              });
          } catch (error) {
            if (duplicateKey(error)) throw identityError(409);
            throw error;
          }
          await c(tx)
            .update(catalogMappingIssues)
            .set({ resolved: true })
            .where(
              and(
                eq(catalogMappingIssues.revisionId, r.id),
                eq(catalogMappingIssues.provider, keyBytes(input.provider)),
                eq(catalogMappingIssues.map, f.map),
                eq(catalogMappingIssues.kind, f.kind),
                eq(catalogMappingIssues.sourceId, keyBytes(input.sourceId)),
              ),
            );
          const [change] = await c(tx)
            .select()
            .from(catalogChanges)
            .where(
              and(eq(catalogChanges.revisionId, r.id), eq(catalogChanges.entityId, f.entityId)),
            );
          const oldMappings = r.comparisonRevisionId
            ? await c(tx)
                .select()
                .from(catalogMappings)
                .where(
                  and(
                    eq(catalogMappings.revisionId, r.comparisonRevisionId),
                    eq(catalogMappings.entityId, f.entityId),
                  ),
                )
            : [];
          const currentMappings = await c(tx)
            .select()
            .from(catalogMappings)
            .where(
              and(eq(catalogMappings.revisionId, r.id), eq(catalogMappings.entityId, f.entityId)),
            );
          const before = mappingSummary(
              oldMappings.map((m) => ({
                provider: m.provider.toString(),
                sourceId: m.sourceId.toString(),
              })),
            ),
            after = mappingSummary(
              currentMappings.map((m) => ({
                provider: m.provider.toString(),
                sourceId: m.sourceId.toString(),
              })),
            );
          const fields = [
            ...(change?.fields ?? []).filter(
              (value) =>
                !(
                  value &&
                  typeof value === "object" &&
                  "field" in value &&
                  value.field === "source_mapping" &&
                  !(
                    "after" in value &&
                    Array.isArray(value.after) &&
                    String(value.after[0]).startsWith("aliases-sha256:")
                  )
                ),
            ),
            { field: "source_mapping", before, after },
          ];
          if (change)
            await c(tx)
              .update(catalogChanges)
              .set({ fields })
              .where(
                and(eq(catalogChanges.revisionId, r.id), eq(catalogChanges.entityId, f.entityId)),
              );
          else
            await c(tx).insert(catalogChanges).values({
              revisionId: r.id,
              entityId: f.entityId,
              kind: f.kind,
              changeKind: "changed",
              fields,
              reasonCodes: [],
            });
          await c(tx)
            .update(catalogRevisions)
            .set({ version: r.version + 1 })
            .where(eq(catalogRevisions.id, r.id));
          const id = newId();
          await c(tx)
            .insert(catalogMappingReviews)
            .values({
              id,
              revisionId: r.id,
              actorId: actor.userId,
              reason: input.reason,
              version: r.version + 1,
              createdAt: at(),
            });
          return { id, version: r.version + 1 };
        });
      });
    },
    async publish(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      input: S["PublicationInput"],
    ): Promise<S["CatalogRevision"]> {
      return run(async (tx) => {
        await authority(tx, actor);
        return once(tx, actor, `publish:${id}`, key, { expected, input }, async () => {
          const observed = await revision(tx, id),
            p = await pointer(tx, observed.game),
            r = await revision(tx, id, true);
          match(r.version, expected);
          match(p.version, input.expectedPublicationVersion);
          if (r.state !== "draft" || r.comparisonRevisionId !== p.revisionId)
            throw identityError(409);
          const dto = await revisionDto(tx, r);
          // Trust is an operator-owned exact-artifact review, never an uploaded boolean.
          const mappingEdits = await c(tx)
            .select({ id: catalogMappingReviews.id })
            .from(catalogMappingReviews)
            .where(eq(catalogMappingReviews.revisionId, r.id))
            .limit(1);
          const issues = await c(tx)
            .select({ id: catalogMappingIssues.id })
            .from(catalogMappingIssues)
            .where(
              and(
                eq(catalogMappingIssues.revisionId, r.id),
                eq(catalogMappingIssues.resolved, false),
              ),
            )
            .limit(1);
          if (
            issues.length ||
            !dto.coverageComplete ||
            !dto.englishLabelsComplete ||
            !dto.sourceReviewComplete ||
            (mappingEdits.length && !(r.synthetic && config.synthetic && !config.production))
          )
            throw identityError(409);
          await c(tx)
            .update(catalogPublications)
            .set({ version: p.version + 1, revisionId: id })
            .where(eq(catalogPublications.game, r.game));
          await c(tx)
            .update(catalogRevisions)
            .set({ state: "published", version: r.version + 1 })
            .where(eq(catalogRevisions.id, id));
          const company = await ports.identity.onboardingCompany(tx);
          await audit.append(tx, {
            actorKind: "user",
            actorId: actor.userId,
            operation: "catalog.published",
            subjectKind: "catalog",
            subjectId: id,
            occurredAt: at(),
            companyId: company.id,
            reason: "catalog_update",
          });
          await ports.published(tx, {
            eventId: newId(),
            revisionId: id,
            version: r.version + 1,
            occurredAt: at(),
          });
          return {
            ...dto,
            state: "published",
            version: r.version + 1,
            publicationVersion: p.version + 1,
          };
        });
      });
    },
    async pinnedFact(input: { revisionId: string; factRevisionId: string }) {
      return run(async (tx) => {
        const r = await revision(tx, input.revisionId);
        if (r.state !== "published") throw identityError(404);
        const [f] = await c(tx)
          .select()
          .from(catalogFacts)
          .where(
            and(
              eq(catalogFacts.revisionId, r.id),
              eq(catalogFacts.id, applicationId(input.factRevisionId)),
            ),
          );
        if (!f) throw identityError(404);
        return {
          factRevisionId: f.id,
          catalogRevisionId: f.revisionId,
          entityId: f.entityId,
          game: f.game,
          kind: f.kind,
          mapNamespace: f.map.toString(),
          retired: f.retired,
          regionId: f.regionId,
          cargoUnitMassKg: f.cargoUnitMassKg,
          adrCategoryId: f.adrCategoryId,
          trailerBodyTypeId: f.trailerBodyTypeId,
          trailerChainTypeId: f.trailerChainTypeId,
        };
      });
    },
    resolveInTransaction,
    async publishedInTransaction(tx: TxContext, game: Game, gameBuild: string) {
      const [p] = await c(tx)
        .select()
        .from(catalogPublications)
        .where(eq(catalogPublications.game, game));
      const [r] = p?.revisionId
        ? await c(tx).select().from(catalogRevisions).where(eq(catalogRevisions.id, p.revisionId))
        : [];
      if (r?.complete && r.state === "published" && r.gameBuild === gameBuild) return r.id;
      const [historical] = await c(tx)
        .select({ id: catalogRevisions.id })
        .from(catalogRevisions)
        .where(
          and(
            eq(catalogRevisions.game, game),
            sql`CAST(${catalogRevisions.gameBuild} AS BINARY) = ${Buffer.from(gameBuild)}`,
            eq(catalogRevisions.complete, true),
            eq(catalogRevisions.state, "published"),
          ),
        )
        .orderBy(desc(catalogRevisions.createdAt), desc(catalogRevisions.id))
        .limit(1);
      return historical?.id ?? null;
    },
    async qualificationReferencesInTransaction(
      tx: TxContext,
      game: Game,
      kind: "trailer_type" | "adr_category",
      ids: string[],
    ) {
      if (ids.length > 1000 || new Set(ids).size !== ids.length) return false;
      if (!ids.length) return true;
      const [publication] = await c(tx)
        .select()
        .from(catalogPublications)
        .where(eq(catalogPublications.game, game))
        .for("share");
      if (!publication?.revisionId) return false;
      const rows = await c(tx)
        .select({ id: catalogFacts.entityId })
        .from(catalogFacts)
        .where(
          and(
            eq(catalogFacts.revisionId, publication.revisionId),
            eq(catalogFacts.kind, kind),
            eq(catalogFacts.retired, false),
            inArray(catalogFacts.entityId, ids.map(applicationId)),
          ),
        );
      return rows.length === ids.length;
    },
    async pinnedInTransaction(tx: TxContext, revisionId: string, entityId: string) {
      const r = await revision(tx, revisionId);
      if (r.state !== "published") return null;
      const [fact] = await c(tx)
        .select()
        .from(catalogFacts)
        .where(
          and(
            eq(catalogFacts.revisionId, r.id),
            eq(catalogFacts.entityId, applicationId(entityId)),
          ),
        );
      return fact ?? null;
    },
    async labelsInTransaction(
      tx: TxContext,
      pins: { revisionId: string; entityId: string }[],
      locale: "en" | "ru",
    ) {
      if (pins.length > 300) throw new Error("CATALOG_LABEL_BATCH_BOUND_EXCEEDED");
      if (!pins.length) return new Map<string, S["CatalogLabel"]>();
      const rows = await c(tx)
        .select()
        .from(catalogFacts)
        .where(
          or(
            ...pins.map((pin) =>
              and(
                eq(catalogFacts.revisionId, applicationId(pin.revisionId)),
                eq(catalogFacts.entityId, applicationId(pin.entityId)),
              ),
            ),
          ),
        );
      return new Map(
        rows
          .filter((f) => f.labelEn)
          .map((f) => [
            `${f.revisionId}:${f.entityId}`,
            {
              entityId: f.entityId,
              label: (locale === "ru" ? (f.labelRu ?? f.labelEn) : f.labelEn) as string,
              requestedLocale: locale,
              renderedLocale: locale === "ru" && f.labelRu ? ("ru" as const) : ("en" as const),
              englishFallback: locale === "ru" && !f.labelRu,
              retired: f.retired,
            },
          ]),
      );
    },
    async resolve(input: {
      revisionId: string;
      game: Game;
      kind: Kind;
      mapNamespace: string | null;
      provider: string;
      sourceId: string | null;
      locale: "en" | "ru" | null;
      label: string | null;
      regionId: string | null;
    }) {
      return run((tx) => resolveInTransaction(tx, input));
    },
  };
}
export type Catalogs = ReturnType<typeof createCatalogs>;
export async function cleanupCatalogs(unit: UnitOfWork, now = () => new Date()) {
  const queue = createQueue(unit);
  await retryTransaction(unit, async (tx) => {
    const c = unit.client(tx),
      at = now().toISOString();
    await c.delete(catalogCommands).where(lte(catalogCommands.expiresAt, at)).limit(100);
    const pending = await c
      .select()
      .from(catalogOperations)
      .where(eq(catalogOperations.state, "processing"))
      .limit(25);
    for (const op of pending) {
      const [artifact] = await c
        .select({ expiresAt: catalogArtifacts.expiresAt })
        .from(catalogArtifacts)
        .where(eq(catalogArtifacts.id, op.artifactId));
      const job = await queue.effectState(
        tx,
        "catalogs",
        op.phase === "identities" && op.offset === 0 ? op.id : `${op.id}:${op.phase}:${op.offset}`,
      );
      const [current] = await c
        .select()
        .from(catalogOperations)
        .where(eq(catalogOperations.id, op.id))
        .for("update");
      if (
        current?.state !== "processing" ||
        current.phase !== op.phase ||
        current.offset !== op.offset
      )
        continue;
      if (artifact && artifact.expiresAt > at && job?.state !== "failed") continue;
      await c
        .update(catalogOperations)
        .set({
          state: "failed",
          failureCode:
            artifact && artifact.expiresAt > at ? "import_processing_failed" : "artifact_expired",
        })
        .where(eq(catalogOperations.id, op.id));
      if (op.stagingRevisionId)
        await c
          .update(catalogRevisions)
          .set({ state: "rejected" })
          .where(
            and(
              eq(catalogRevisions.id, op.stagingRevisionId),
              eq(catalogRevisions.complete, false),
            ),
          );
    }
    const rejected = await c
      .select({ id: catalogRevisions.id })
      .from(catalogRevisions)
      .where(
        and(
          eq(catalogRevisions.complete, false),
          eq(catalogRevisions.state, "rejected"),
          eq(catalogRevisions.pruned, false),
        ),
      )
      .limit(5);
    for (const { id } of rejected) {
      // Retain operation/revision metadata; prune inaccessible partial normalized
      // rows in restrictive FK order and bounded batches. Never touch publication.
      await c.delete(catalogRelations).where(eq(catalogRelations.revisionId, id)).limit(100);
      await c.delete(catalogMappings).where(eq(catalogMappings.revisionId, id)).limit(100);
      await c.delete(catalogAliases).where(eq(catalogAliases.revisionId, id)).limit(100);
      const [relation] = await c
        .select({ id: catalogRelations.entityId })
        .from(catalogRelations)
        .where(eq(catalogRelations.revisionId, id))
        .limit(1);
      const [mapping] = await c
        .select({ id: catalogMappings.entityId })
        .from(catalogMappings)
        .where(eq(catalogMappings.revisionId, id))
        .limit(1);
      const [alias] = await c
        .select({ id: catalogAliases.entityId })
        .from(catalogAliases)
        .where(eq(catalogAliases.revisionId, id))
        .limit(1);
      if (!relation && !mapping && !alias)
        await c.delete(catalogFacts).where(eq(catalogFacts.revisionId, id)).limit(100);
      await c.delete(catalogChanges).where(eq(catalogChanges.revisionId, id)).limit(100);
      await c.delete(catalogCoverage).where(eq(catalogCoverage.revisionId, id)).limit(100);
      await c
        .delete(catalogMappingIssues)
        .where(eq(catalogMappingIssues.revisionId, id))
        .limit(100);
      const [fact] = await c
        .select({ id: catalogFacts.id })
        .from(catalogFacts)
        .where(eq(catalogFacts.revisionId, id))
        .limit(1);
      const [change] = await c
        .select({ id: catalogChanges.entityId })
        .from(catalogChanges)
        .where(eq(catalogChanges.revisionId, id))
        .limit(1);
      const [coverage] = await c
        .select({ id: catalogCoverage.packId })
        .from(catalogCoverage)
        .where(eq(catalogCoverage.revisionId, id))
        .limit(1);
      const [issue] = await c
        .select({ id: catalogMappingIssues.id })
        .from(catalogMappingIssues)
        .where(eq(catalogMappingIssues.revisionId, id))
        .limit(1);
      if (!relation && !mapping && !alias && !fact && !change && !coverage && !issue)
        await c.update(catalogRevisions).set({ pruned: true }).where(eq(catalogRevisions.id, id));
    }
    // Keep metadata/history and reference locks; clear only expired private bytes.
    await c
      .update(catalogArtifacts)
      .set({ content: null, payloadExpiresAt: null })
      .where(lte(catalogArtifacts.payloadExpiresAt, at))
      .limit(25);
  });
}
