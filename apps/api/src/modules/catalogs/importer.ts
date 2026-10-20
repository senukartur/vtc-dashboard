import type { components } from "@vtc/contracts";
import { applicationId, newId, opaqueUtf8, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  catalogAliases,
  catalogArtifacts,
  catalogChanges,
  catalogCoverage,
  catalogEntities,
  catalogFacts,
  catalogMappingIssues,
  catalogMappings,
  catalogOperations,
  catalogPublications,
  catalogRelations,
  catalogRevisions,
  eq,
  inArray,
  or,
} from "@vtc/db/catalogs-schema";
import { createQueue, type Handler, retryTransaction } from "../../platform/jobs/queue.js";
import { closed } from "../../platform/outbox/events.js";
import {
  type Artifact,
  aliasKey,
  type CatalogConfig,
  CatalogInputError,
  type EntityInput,
  entityKey,
  hash,
  type Kind,
  mappingSummary,
  parseArtifact,
  semantic,
} from "./artifact.js";

export const importBatch = 100;
const phases = ["identities", "facts", "links", "issues", "finalize"] as const;
type Phase = (typeof phases)[number];
type Reference = {
  operationId: string;
  artifactId: string;
  sha256: string;
  phase: Phase;
  offset: number;
};
type Prepared = { reference: Reference; artifact: Artifact | null; failure: string | null };
type Fact = typeof catalogFacts.$inferSelect;
const bytes = (s: string) => opaqueUtf8(s, 512);
export function createImportHandler(
  unit: UnitOfWork,
  config: CatalogConfig,
  now = () => new Date(),
): Handler {
  const c = (tx: TxContext) => unit.client(tx),
    run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn),
    at = () => now().toISOString();
  async function identities(
    tx: TxContext,
    game: "ats" | "ets2",
    inputs: Pick<EntityInput, "kind" | "mapNamespace" | "key">[],
  ) {
    const unique = [...new Map(inputs.map((e) => [entityKey(e), e])).values()];
    const rows = unique.length
      ? await c(tx)
          .select()
          .from(catalogEntities)
          .where(
            and(
              eq(catalogEntities.game, game),
              or(
                ...unique.map((e) =>
                  and(
                    eq(catalogEntities.kind, e.kind),
                    eq(catalogEntities.map, bytes(e.mapNamespace)),
                    eq(catalogEntities.sourceKey, bytes(e.key)),
                  ),
                ),
              ),
            ),
          )
      : [];
    return new Map(
      rows.map((e) => [JSON.stringify([e.kind, e.map.toString(), e.sourceKey.toString()]), e.id]),
    );
  }
  const handler: Handler = {
    kind: "catalog.import",
    version: 1,
    consumer: "catalogs",
    mode: "local",
    validate(input) {
      const r = closed(input, ["operationId", "artifactId", "sha256", "phase", "offset"]);
      applicationId(r.operationId as string);
      applicationId(r.artifactId as string);
      if (
        !/^[0-9a-f]{64}$/.test(r.sha256 as string) ||
        !(phases as readonly unknown[]).includes(r.phase) ||
        !Number.isSafeInteger(r.offset) ||
        Number(r.offset) < 0 ||
        Number(r.offset) > 100000
      )
        throw new Error("INVALID_REFERENCE");
      return r;
    },
    async prepare(input, _claim, signal): Promise<Prepared> {
      const reference = input as Reference;
      signal.throwIfAborted();
      const stored = await run(
        async (tx) =>
          (
            await c(tx)
              .select()
              .from(catalogArtifacts)
              .where(eq(catalogArtifacts.id, reference.artifactId))
          )[0],
      );
      signal.throwIfAborted();
      if (
        !stored?.content ||
        stored.sha256.toString("hex") !== reference.sha256 ||
        hash(stored.content) !== reference.sha256
      )
        return { reference, artifact: null, failure: "artifact_unavailable" };
      try {
        const artifact = parseArtifact(Buffer.from(stored.content));
        signal.throwIfAborted();
        return { reference, artifact, failure: null };
      } catch (e) {
        return {
          reference,
          artifact: null,
          failure: e instanceof CatalogInputError ? e.code : "invalid_artifact",
        };
      }
    },
    async local(tx, input, _claim, raw) {
      const ref = input as Reference,
        prepared = raw as Prepared;
      // Writers lock the game pointer before their operation/candidate rows. Cleanup
      // never locks a pointer; publication uses identity -> pointer -> candidate.
      const [observed] = await c(tx)
        .select()
        .from(catalogOperations)
        .where(eq(catalogOperations.id, ref.operationId));
      if (!observed) throw new Error("INVALID_REFERENCE");
      await c(tx)
        .insert(catalogPublications)
        .values({ game: observed.game, version: 1, revisionId: null })
        .onDuplicateKeyUpdate({ set: { game: observed.game } });
      const [p] = await c(tx)
        .select()
        .from(catalogPublications)
        .where(eq(catalogPublications.game, observed.game))
        .for("update");
      const [op] = await c(tx)
        .select()
        .from(catalogOperations)
        .where(eq(catalogOperations.id, ref.operationId))
        .for("update");
      if (!op || !p || op.artifactId !== ref.artifactId) throw new Error("INVALID_REFERENCE");
      if (op.state !== "processing" || op.phase !== ref.phase || op.offset !== ref.offset) return;
      const [stored] = await c(tx)
        .select()
        .from(catalogArtifacts)
        .where(eq(catalogArtifacts.id, ref.artifactId))
        .for("share");
      if (
        !stored ||
        stored.sha256.toString("hex") !== ref.sha256 ||
        semantic(prepared.reference) !== semantic(ref)
      )
        throw new Error("INVALID_PREPARATION");
      const a = prepared.artifact;
      async function fail(code: string) {
        await c(tx)
          .update(catalogOperations)
          .set({ state: "failed", failureCode: code })
          .where(eq(catalogOperations.id, op?.id as string));
        if (op?.stagingRevisionId)
          await c(tx)
            .update(catalogRevisions)
            .set({ state: "rejected" })
            .where(eq(catalogRevisions.id, op.stagingRevisionId));
      }
      if (
        !a ||
        prepared.failure ||
        !stored.content ||
        stored.expiresAt <= at() ||
        a.game !== op.game ||
        (a.synthetic && (!config.synthetic || config.production))
      ) {
        await fail(prepared.failure ?? "artifact_unavailable");
        return;
      }
      const revisionId = op.stagingRevisionId ?? newId();
      if (!op.stagingRevisionId) {
        await c(tx)
          .insert(catalogRevisions)
          .values({
            id: revisionId,
            game: a.game,
            version: 1,
            state: "draft",
            complete: false,
            artifactId: ref.artifactId,
            artifactSha256: stored.sha256,
            comparisonRevisionId: p.revisionId,
            gameBuild: a.gameBuild,
            inventoryAsOf: a.releaseInventoryAsOf,
            synthetic: a.synthetic,
            sourceManifestSha256: Buffer.from(a.sourceManifestSha256, "hex"),
            provenance: a.provenance,
            createdAt: at(),
          });
        await c(tx)
          .update(catalogOperations)
          .set({ stagingRevisionId: revisionId })
          .where(eq(catalogOperations.id, op.id));
      }
      const chunk = a.entities.slice(op.offset, op.offset + importBatch);
      if (op.phase === "identities") {
        const existing = await identities(tx, a.game, chunk);
        const fresh = chunk
          .filter((e) => !existing.has(entityKey(e)))
          .map((e) => ({
            id: newId(),
            game: a.game,
            kind: e.kind,
            map: bytes(e.mapNamespace),
            sourceKey: bytes(e.key),
          }));
        if (fresh.length) await c(tx).insert(catalogEntities).values(fresh);
      }
      if (op.phase === "facts") {
        const required = chunk.flatMap((e) => [
          e,
          ...(
            [
              ["region", e.regionKey],
              ["adr_category", e.adrCategoryKey],
              ["trailer_body_type", e.trailerBodyTypeKey],
              ["trailer_chain_type", e.trailerChainTypeKey],
            ] as const
          ).flatMap(([kind, key]) =>
            key === null ? [] : [{ kind, mapNamespace: e.mapNamespace, key }],
          ),
        ]);
        const known = await identities(tx, a.game, required);
        const facts: Fact[] = chunk.map((e) => {
          const get = (kind: Kind, key: string | null) =>
            key === null
              ? null
              : (known.get(JSON.stringify([kind, e.mapNamespace, key])) as string);
          return {
            id: newId(),
            revisionId,
            entityId: known.get(entityKey(e)) as string,
            game: a.game,
            kind: e.kind,
            map: bytes(e.mapNamespace),
            retired: e.retired,
            labelEn: e.labels.en,
            labelRu: e.labels.ru,
            packId: bytes(e.packId),
            regionId: get("region", e.regionKey),
            cargoUnitMassKg: e.cargoUnitMassKg,
            adrCategoryId: get("adr_category", e.adrCategoryKey),
            trailerBodyTypeId: get("trailer_body_type", e.trailerBodyTypeKey),
            trailerChainTypeId: get("trailer_chain_type", e.trailerChainTypeKey),
          };
        });
        if (facts.length) await c(tx).insert(catalogFacts).values(facts);
      }
      if (op.phase === "links") {
        const known = await identities(tx, a.game, chunk),
          ids = [...known.values()];
        const facts = ids.length
          ? await c(tx)
              .select()
              .from(catalogFacts)
              .where(
                and(eq(catalogFacts.revisionId, revisionId), inArray(catalogFacts.entityId, ids)),
              )
          : [];
        const [r] = await c(tx)
          .select()
          .from(catalogRevisions)
          .where(eq(catalogRevisions.id, revisionId));
        const previous =
          r?.comparisonRevisionId && ids.length
            ? await c(tx)
                .select()
                .from(catalogFacts)
                .where(
                  and(
                    eq(catalogFacts.revisionId, r.comparisonRevisionId),
                    inArray(catalogFacts.entityId, ids),
                  ),
                )
            : [];
        const previousMappings =
          r?.comparisonRevisionId && ids.length
            ? await c(tx)
                .select()
                .from(catalogMappings)
                .where(
                  and(
                    eq(catalogMappings.revisionId, r.comparisonRevisionId),
                    inArray(catalogMappings.entityId, ids),
                  ),
                )
            : [];
        const previousAliases =
          r?.comparisonRevisionId && ids.length
            ? await c(tx)
                .select()
                .from(catalogAliases)
                .where(
                  and(
                    eq(catalogAliases.revisionId, r.comparisonRevisionId),
                    inArray(catalogAliases.entityId, ids),
                  ),
                )
            : [];
        const byEntity = new Map(previous.map((f) => [f.entityId, f])),
          byKey = new Map(chunk.map((e) => [known.get(entityKey(e)), e]));
        const relations: (typeof catalogRelations.$inferInsert)[] = [],
          mappings: (typeof catalogMappings.$inferInsert)[] = [],
          aliases: (typeof catalogAliases.$inferInsert)[] = [],
          changes: (typeof catalogChanges.$inferInsert)[] = [];
        for (const f of facts) {
          const e = byKey.get(f.entityId) as EntityInput;
          for (const [relation, targetId] of [
            ["region", f.regionId],
            ["adr_category", f.adrCategoryId],
            ["trailer_body_type", f.trailerBodyTypeId],
            ["trailer_chain_type", f.trailerChainTypeId],
          ] as const)
            if (targetId)
              relations.push({
                revisionId,
                entityId: f.entityId,
                relation,
                targetId,
                targetKind: relation,
                map: f.map,
              });
          for (const m of e.mappings)
            mappings.push({
              revisionId,
              game: a.game,
              kind: f.kind,
              map: f.map,
              provider: bytes(m.provider),
              sourceId: bytes(m.sourceId),
              entityId: f.entityId,
            });
          for (const alias of e.aliases)
            aliases.push({
              revisionId,
              entityId: f.entityId,
              locale: alias.locale,
              normalized: opaqueUtf8(aliasKey(alias.label), 512),
              regionScope: Buffer.from(alias.regionKey === null ? "*" : (f.regionId as string)),
            });
          const old = byEntity.get(f.entityId),
            fields: components["schemas"]["CatalogFieldChange"][] = [];
          for (const [field, property] of [
            ["label_en", "labelEn"],
            ["label_ru", "labelRu"],
            ["region_id", "regionId"],
            ["cargo_unit_mass_kg", "cargoUnitMassKg"],
            ["adr_category_id", "adrCategoryId"],
            ["trailer_body_type_id", "trailerBodyTypeId"],
            ["trailer_chain_type_id", "trailerChainTypeId"],
            ["retired", "retired"],
          ] as const) {
            const before = old?.[property] ?? null,
              after = f[property];
            const normalized = (v: unknown) =>
              property === "cargoUnitMassKg" && typeof v === "string"
                ? v.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
                : v;
            if (semantic(normalized(before)) !== semantic(normalized(after)))
              fields.push({ field, before, after });
          }
          const beforeMappings = mappingSummary(
              previousMappings
                .filter((m) => m.entityId === f.entityId)
                .map((m) => ({ provider: m.provider.toString(), sourceId: m.sourceId.toString() })),
            ),
            afterMappings = mappingSummary(e.mappings);
          if (semantic(beforeMappings) !== semantic(afterMappings))
            fields.push({ field: "source_mapping", before: beforeMappings, after: afterMappings });
          const beforeAliases = previousAliases
              .filter((a) => a.entityId === f.entityId)
              .map((a) => ({
                locale: a.locale,
                normalized: a.normalized.toString(),
                regionScope: a.regionScope.toString(),
              })),
            afterAliases = e.aliases.map((a) => ({
              locale: a.locale,
              normalized: aliasKey(a.label),
              regionScope: a.regionKey === null ? "*" : f.regionId,
            }));
          const aliasChanged = semantic(beforeAliases) !== semantic(afterAliases);
          if (aliasChanged)
            fields.push({
              field: "source_mapping",
              before: [`aliases-sha256:${hash(semantic(beforeAliases))}`],
              after: [`aliases-sha256:${hash(semantic(afterAliases))}`],
            });
          if (!old || fields.length)
            changes.push({
              revisionId,
              entityId: f.entityId,
              kind: f.kind,
              changeKind: !old ? "added" : !old.retired && f.retired ? "retired" : "changed",
              fields,
              reasonCodes: aliasChanged ? ["aliases_changed"] : [],
            });
        }
        if (relations.length) await c(tx).insert(catalogRelations).values(relations);
        if (mappings.length) await c(tx).insert(catalogMappings).values(mappings);
        if (aliases.length) await c(tx).insert(catalogAliases).values(aliases);
        if (changes.length) await c(tx).insert(catalogChanges).values(changes);
      }
      if (op.phase === "issues") {
        const issues = a.mappingIssues.slice(op.offset, op.offset + 10);
        if (issues.length) {
          const keys = issues.flatMap((issue) =>
            issue.candidateKeys.map((key) => ({
              kind: issue.kind,
              mapNamespace: issue.mapNamespace,
              key,
            })),
          );
          const known = await identities(tx, a.game, keys);
          await c(tx)
            .insert(catalogMappingIssues)
            .values(
              issues.map((issue) => ({
                id: newId(),
                revisionId,
                provider: bytes(issue.provider),
                kind: issue.kind,
                map: bytes(issue.mapNamespace),
                sourceId: issue.sourceId === null ? null : bytes(issue.sourceId),
                sourceLocale: issue.sourceLocale,
                reasonCode: issue.reasonCode,
                candidateEntityIds: issue.candidateKeys.map(
                  (key) =>
                    known.get(JSON.stringify([issue.kind, issue.mapNamespace, key])) as string,
                ),
                resolved: false,
              })),
            );
        }
      }
      if (op.phase === "finalize") {
        const [r] = await c(tx)
          .select()
          .from(catalogRevisions)
          .where(eq(catalogRevisions.id, revisionId));
        if (!r) throw new Error("INVALID_STAGING_REFERENCE");
        // Indexed anti-join, bounded to one missing prior fact. Missing sources
        // cannot imply retirement or erase historically published definitions.
        if (r.comparisonRevisionId) {
          const { alias } = await import("drizzle-orm/mysql-core");
          const prior = alias(catalogFacts, "prior_catalog_fact"),
            current = alias(catalogFacts, "new_catalog_fact");
          const omitted = await c(tx)
            .select({ id: prior.entityId })
            .from(prior)
            .leftJoin(
              current,
              and(eq(current.revisionId, revisionId), eq(current.entityId, prior.entityId)),
            )
            .where(
              and(
                eq(prior.revisionId, r.comparisonRevisionId),
                (await import("drizzle-orm")).isNull(current.entityId),
              ),
            )
            .limit(1);
          if (omitted.length) {
            await fail("omitted_historical_entity");
            return;
          }
        }
        await c(tx)
          .insert(catalogCoverage)
          .values(a.packs.map((pack) => ({ revisionId, ...pack, packId: bytes(pack.packId) })));
        await c(tx)
          .update(catalogRevisions)
          .set({ complete: true })
          .where(eq(catalogRevisions.id, revisionId));
        await c(tx)
          .update(catalogOperations)
          .set({ state: "completed", resultId: revisionId })
          .where(eq(catalogOperations.id, op.id));
        return;
      }
      const batch = op.phase === "issues" ? 10 : importBatch,
        count = op.phase === "issues" ? a.mappingIssues.length : a.entities.length;
      const more = op.offset + batch < count;
      const next = {
        phase: more ? op.phase : (phases[phases.indexOf(op.phase) + 1] as Phase),
        offset: more ? op.offset + batch : 0,
      };
      await c(tx).update(catalogOperations).set(next).where(eq(catalogOperations.id, op.id));
      await createQueue(unit, [handler]).enqueue(tx, {
        kind: handler.kind,
        schemaVersion: 1,
        consumer: handler.consumer,
        effectKey: `${op.id}:${next.phase}:${next.offset}`,
        eventId: null,
        reference: { ...ref, ...next },
        availableAt: at(),
        maxAttempts: 5,
      });
    },
  };
  return handler;
}
