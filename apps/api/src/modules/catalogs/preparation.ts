import { createHash } from "node:crypto";
import { posix } from "node:path";
import { decimal38_18 } from "@vtc/db";
import { z } from "zod";
import type { parseRegistries } from "../../../../../scripts/catalogs/registry.mjs";
import { type Artifact, artifactSchema, entityKey, parseArtifact } from "./artifact.js";

const reviewSchema = z.strictObject({
  artifact: artifactSchema.omit({ sourceManifestSha256: true }),
  ignoredUnits: z
    .array(
      z.strictObject({
        unitType: z.string(),
        unitId: z.string(),
        unitScope: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        reasonCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/),
      }),
    )
    .max(100000),
  // Every source-derived entity names its exact active unit. Human labels,
  // aliases, source mappings and typed references remain explicit reviewed input.
  bindings: z
    .array(
      z.strictObject({
        kind: z.enum([
          "city",
          "region",
          "cargo",
          "trailer_type",
          "trailer_body_type",
          "trailer_chain_type",
          "adr_category",
        ]),
        mapNamespace: z.string(),
        key: z.string(),
        unitType: z.string(),
        unitId: z.string(),
        unitScope: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        sourceFacts: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
        classification: z
          .strictObject({
            field: z.enum(["adr_class", "body_type", "body_types[]", "chain_type"]),
            token: z.string(),
          })
          .optional(),
      }),
    )
    .max(100000),
  sourceReferences: z
    .array(
      z.strictObject({
        mapNamespace: z.string(),
        sourceUnitId: z.string(),
        sourceToken: z.string(),
        targetUnitId: z.string(),
        targetSourceToken: z.string().optional(),
      }),
    )
    .max(100000)
    .default([]),
});
type RegistryResult = Awaited<ReturnType<typeof parseRegistries>>;
const unitKey = (type: string, id: string, scope?: string) =>
  JSON.stringify([type, id, scope ?? null]);
export function buildArtifact(parsed: RegistryResult, input: unknown): Artifact {
  const review = reviewSchema.parse(input),
    bindings = new Map(review.bindings.map((b) => [entityKey(b), b]));
  if (bindings.size !== review.bindings.length) throw new Error("DUPLICATE_BINDING");
  const units = new Map(parsed.units.map((u) => [unitKey(u.type, u.id, u.scope), u]));
  if (units.size !== parsed.units.length) throw new Error("DUPLICATE_SOURCE_UNIT");
  const ignored = new Set(
    review.ignoredUnits.map((u) => unitKey(u.unitType, u.unitId, u.unitScope)),
  );
  if (ignored.size !== review.ignoredUnits.length || [...ignored].some((key) => !units.has(key)))
    throw new Error("INVALID_IGNORED_UNIT");
  const sourceKinds: Record<string, string> = {
    city_data: "city",
    country_data: "region",
    cargo_data: "cargo",
    trailer_def: "trailer_type",
  };
  const bindingsByUnit = new Map<string, typeof review.bindings>();
  for (const binding of review.bindings) {
    const key = unitKey(binding.unitType, binding.unitId, binding.unitScope);
    const group = bindingsByUnit.get(key) ?? [];
    group.push(binding);
    bindingsByUnit.set(key, group);
  }
  for (const unit of parsed.units) {
    const sourceKey = unitKey(unit.type, unit.id, unit.scope);
    const bound = bindingsByUnit.get(sourceKey) ?? [];
    if (
      sourceKinds[unit.type] &&
      (bound.filter((b) => b.kind === sourceKinds[unit.type]).length !== 1 ||
        ignored.has(sourceKey))
    )
      throw new Error("UNBOUND_CATALOG_UNIT");
    if (bound.length && ignored.has(sourceKey)) throw new Error("INVALID_IGNORED_UNIT");
    if (!bound.length && !ignored.has(sourceKey)) throw new Error("UNREVIEWED_SOURCE_UNIT");
  }
  for (const entity of review.artifact.entities) {
    const binding = bindings.get(entityKey(entity));
    if (!binding) throw new Error("MISSING_REVIEWED_SOURCE_BINDING");
    const unit = units.get(unitKey(binding.unitType, binding.unitId, binding.unitScope));
    if (
      !unit ||
      !(unit.coOrigins ?? [unit.origin]).some((origin) => origin.packId === entity.packId) ||
      JSON.stringify(Object.entries(unit.values).sort()) !==
        JSON.stringify(Object.entries(binding.sourceFacts).sort())
    )
      throw new Error("SOURCE_BINDING_MISMATCH");
    const derived = ["adr_category", "trailer_body_type", "trailer_chain_type"].includes(
      entity.kind,
    );
    if (!derived && sourceKinds[binding.unitType] !== entity.kind)
      throw new Error("SOURCE_KIND_MISMATCH");
    if (derived) {
      const proof = binding.classification;
      const validField =
        proof &&
        ((entity.kind === "adr_category" &&
          binding.unitType === "cargo_data" &&
          proof.field === "adr_class") ||
          (entity.kind === "trailer_body_type" &&
            ((binding.unitType === "cargo_data" && proof.field === "body_types[]") ||
              (binding.unitType === "trailer_def" && proof.field === "body_type"))) ||
          (entity.kind === "trailer_chain_type" &&
            binding.unitType === "trailer_def" &&
            proof.field === "chain_type"));
      const observed = proof ? unit.values[proof.field] : undefined;
      if (
        !proof ||
        !validField ||
        entity.key !== proof.token ||
        !(Array.isArray(observed) ? observed.includes(proof.token) : observed === proof.token)
      )
        throw new Error("INVALID_CLASSIFICATION_BINDING");
    } else if (binding.classification) throw new Error("INVALID_CLASSIFICATION_BINDING");
    if (entity.kind === "cargo") {
      const mass = unit.values.mass,
        legacy = unit.values.unit_mass;
      if (
        mass !== undefined &&
        legacy !== undefined &&
        canonicalUnitMass(mass) !== canonicalUnitMass(legacy)
      )
        throw new Error("MASS_FIELD_CONFLICT");
      const sourceMass = mass ?? legacy;
      if (sourceMass !== undefined && entity.cargoUnitMassKg !== canonicalUnitMass(sourceMass))
        throw new Error("UNIT_MASS_MISMATCH");
      if (parsed.sourceMode === "unique_providers" && sourceMass === undefined)
        throw new Error("MISSING_UNIT_MASS");
    }
    if (parsed.sourceMode === "unique_providers") {
      if (entity.kind === "cargo" && entity.adrCategoryKey !== (unit.values.adr_class ?? null))
        throw new Error("SOURCE_RELATION_MISMATCH");
      if (
        entity.kind === "trailer_type" &&
        (entity.trailerBodyTypeKey !== (unit.values.body_type ?? null) ||
          entity.trailerChainTypeKey !== (unit.values.chain_type ?? null))
      )
        throw new Error("SOURCE_RELATION_MISMATCH");
    }
    // A reviewed name may differ from a source localization token; neither a
    // token nor a source display label autonomously creates an English alias.
  }
  const referenceKeys = new Set<string>();
  for (const reference of review.sourceReferences) {
    const key = JSON.stringify([reference.mapNamespace, reference.sourceUnitId]);
    if (referenceKeys.has(key)) throw new Error("INVALID_SOURCE_REFERENCE");
    referenceKeys.add(key);
    const city = units.get(unitKey("city_data", reference.sourceUnitId));
    const country = units.get(unitKey("country_data", reference.targetUnitId));
    // An exceptional source-to-target token pair must be explicitly reviewed;
    // the builder never case-folds source tokens or canonical/provider IDs.
    const targetToken = reference.targetSourceToken ?? reference.sourceToken;
    if (
      !city ||
      !country ||
      city.values.country !== reference.sourceToken ||
      country.id !== `country.data.${targetToken}` ||
      ![`${targetToken}.sui`, `${targetToken}.sii`].includes(posix.basename(country.origin.file))
    )
      throw new Error("INVALID_SOURCE_REFERENCE");
    const cityBinding = (bindingsByUnit.get(unitKey(city.type, city.id)) ?? []).find(
      (b) => b.kind === "city" && b.mapNamespace === reference.mapNamespace,
    );
    const countryBinding = (bindingsByUnit.get(unitKey(country.type, country.id)) ?? []).find(
      (b) => b.kind === "region" && b.mapNamespace === reference.mapNamespace,
    );
    const entity =
      cityBinding && review.artifact.entities.find((e) => entityKey(e) === entityKey(cityBinding));
    if (!entity || !countryBinding || entity.regionKey !== countryBinding.key)
      throw new Error("INVALID_SOURCE_REFERENCE");
  }
  if (parsed.sourceMode === "unique_providers")
    for (const binding of review.bindings.filter((b) => b.kind === "city"))
      if (!referenceKeys.has(JSON.stringify([binding.mapNamespace, binding.unitId])))
        throw new Error("MISSING_SOURCE_REFERENCE");
  if (bindings.size !== review.artifact.entities.length) throw new Error("UNUSED_REVIEWED_BINDING");
  const sourceManifestSha256 =
    parsed.sourceMode === "unique_providers"
      ? createHash("sha256")
          .update(
            JSON.stringify({
              version: 2,
              sourceManifestSha256: parsed.sourceManifestSha256,
              sourceReferences: [...review.sourceReferences].sort((a, b) =>
                JSON.stringify(a) < JSON.stringify(b)
                  ? -1
                  : JSON.stringify(a) > JSON.stringify(b)
                    ? 1
                    : 0,
              ),
              bindings: review.bindings
                .map((b) => ({
                  kind: b.kind,
                  mapNamespace: b.mapNamespace,
                  key: b.key,
                  unitType: b.unitType,
                  unitId: b.unitId,
                  unitScope: b.unitScope ?? null,
                  classification: b.classification ?? null,
                }))
                .sort((a, b) =>
                  JSON.stringify(a) < JSON.stringify(b)
                    ? -1
                    : JSON.stringify(a) > JSON.stringify(b)
                      ? 1
                      : 0,
                ),
            }),
          )
          .digest("hex")
      : parsed.sourceManifestSha256;
  const a = { ...review.artifact, sourceManifestSha256 };
  return parseArtifact(Buffer.from(JSON.stringify(a)));
}
function canonicalUnitMass(value: string | string[]) {
  if (typeof value !== "string" || value.startsWith("-")) throw new Error("INVALID_UNIT_MASS");
  decimal38_18(value);
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
export function sourceManifest(input: unknown) {
  return z
    .strictObject({
      layers: z.array(
        z.strictObject({
          root: z.string(),
          packId: z.string(),
          registries: z.array(z.string()),
          overlay: z.boolean().optional(),
          sourceId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
          files: z
            .array(z.strictObject({ file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
            .max(10000)
            .optional(),
        }),
      ),
      resolution: z.literal("unique_providers").optional(),
    })
    .parse(input);
}
