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
        sourceFacts: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
      }),
    )
    .max(100000),
});
type RegistryResult = Awaited<ReturnType<typeof parseRegistries>>;
export function buildArtifact(parsed: RegistryResult, input: unknown): Artifact {
  const review = reviewSchema.parse(input),
    bindings = new Map(review.bindings.map((b) => [entityKey(b), b]));
  if (bindings.size !== review.bindings.length) throw new Error("DUPLICATE_BINDING");
  const units = new Map(parsed.units.map((u) => [`${u.type}:${u.id}`, u]));
  const ignored = new Set(review.ignoredUnits.map((u) => `${u.unitType}:${u.unitId}`));
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
    const key = `${binding.unitType}:${binding.unitId}`;
    const group = bindingsByUnit.get(key) ?? [];
    group.push(binding);
    bindingsByUnit.set(key, group);
  }
  for (const unit of parsed.units) {
    const bound = bindingsByUnit.get(`${unit.type}:${unit.id}`) ?? [];
    if (
      sourceKinds[unit.type] &&
      (bound.filter((b) => b.kind === sourceKinds[unit.type]).length !== 1 ||
        ignored.has(`${unit.type}:${unit.id}`))
    )
      throw new Error("UNBOUND_CATALOG_UNIT");
    if (!bound.length && !ignored.has(`${unit.type}:${unit.id}`))
      throw new Error("UNREVIEWED_SOURCE_UNIT");
  }
  for (const entity of review.artifact.entities) {
    const binding = bindings.get(entityKey(entity));
    if (!binding) throw new Error("MISSING_REVIEWED_SOURCE_BINDING");
    const unit = units.get(`${binding.unitType}:${binding.unitId}`);
    if (
      !unit ||
      unit.origin.packId !== entity.packId ||
      JSON.stringify(Object.entries(unit.values).sort()) !==
        JSON.stringify(Object.entries(binding.sourceFacts).sort())
    )
      throw new Error("SOURCE_BINDING_MISMATCH");
    if (
      sourceKinds[binding.unitType] &&
      ![
        sourceKinds[binding.unitType],
        "adr_category",
        "trailer_body_type",
        "trailer_chain_type",
      ].includes(entity.kind)
    )
      throw new Error("SOURCE_KIND_MISMATCH");
    if (
      entity.kind === "cargo" &&
      unit.values.unit_mass !== undefined &&
      entity.cargoUnitMassKg !== canonicalUnitMass(unit.values.unit_mass)
    )
      throw new Error("UNIT_MASS_MISMATCH");
    // A reviewed name may differ from a source localization token; neither a
    // token nor a source display label autonomously creates an English alias.
  }
  if (bindings.size !== review.artifact.entities.length) throw new Error("UNUSED_REVIEWED_BINDING");
  const a = { ...review.artifact, sourceManifestSha256: parsed.sourceManifestSha256 };
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
        }),
      ),
    })
    .parse(input);
}
