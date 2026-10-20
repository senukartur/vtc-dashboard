import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { applicationId, decimal38_18 } from "@vtc/db";
import { z } from "zod";

export const kinds = [
  "city",
  "region",
  "cargo",
  "trailer_type",
  "trailer_body_type",
  "trailer_chain_type",
  "adr_category",
] as const;
export type Kind = (typeof kinds)[number];
export type Game = "ets2" | "ats";
const exact = z
  .string()
  .min(1)
  .refine(
    (v) => [...v].length <= 128 && Buffer.byteLength(v) <= 512 && Buffer.from(v).toString() === v,
  );
const code = z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const label = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (v) =>
      v.trim() === v &&
      Buffer.from(v).toString() === v &&
      !v.includes("@@") &&
      ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
const uuid = z.string().refine((v) => {
  try {
    applicationId(v);
    return true;
  } catch {
    return false;
  }
});
export const provenanceSchema = z.strictObject({
  referenceId: uuid,
  publicSourceUrl: z.url().refine((v) => {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash;
  }),
  attribution: z.string().min(1).max(2048),
  permittedUseBasis: z.string().min(1).max(2048),
  observedAt: z.iso.datetime({ precision: 3 }),
});
const packSchema = z.strictObject({
  packId: code,
  title: label,
  state: z.enum(["validated", "missing", "failed", "non_contributing"]),
  contributionKinds: z.array(z.enum(kinds)).max(7),
  provenance: z.array(provenanceSchema).max(16),
  reasonCodes: z.array(code).max(32),
});
const decimal = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d*[1-9])?$/)
  .refine((v) => {
    try {
      decimal38_18(v);
      return true;
    } catch {
      return false;
    }
  });
export const entitySchema = z.strictObject({
  key: exact,
  kind: z.enum(kinds),
  mapNamespace: exact,
  packId: code,
  retired: z.boolean(),
  labels: z.strictObject({ en: label.nullable(), ru: label.nullable() }),
  aliases: z
    .array(
      z.strictObject({
        locale: z.enum(["en", "ru"]),
        label: label.refine((v) => Buffer.byteLength(aliasKey(v)) <= 512),
        regionKey: exact.nullable(),
      }),
    )
    .max(64),
  mappings: z.array(z.strictObject({ provider: exact, sourceId: exact })).max(64),
  regionKey: exact.nullable(),
  cargoUnitMassKg: decimal.nullable(),
  adrCategoryKey: exact.nullable(),
  trailerBodyTypeKey: exact.nullable(),
  trailerChainTypeKey: exact.nullable(),
});
export const artifactSchema = z.strictObject({
  schemaVersion: z.literal(1),
  importerVersion: z.literal("vtc-catalogs/1"),
  synthetic: z.boolean(),
  game: z.enum(["ets2", "ats"]),
  gameBuild: exact,
  releaseInventoryAsOf: z.iso.date(),
  sourceManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  packs: z.array(packSchema).min(1).max(512),
  provenance: z.array(provenanceSchema).max(64),
  entities: z.array(entitySchema).min(1).max(100000),
  mappingIssues: z
    .array(
      z.strictObject({
        provider: exact,
        kind: z.enum(kinds),
        mapNamespace: exact,
        sourceId: exact.nullable(),
        sourceLocale: z.enum(["en", "ru"]).nullable(),
        reasonCode: code,
        candidateKeys: z.array(exact).max(100),
      }),
    )
    .max(10000),
});
export type Artifact = z.infer<typeof artifactSchema>;
export type EntityInput = Artifact["entities"][number];
export const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function mappingSummary(mappings: { provider: string; sourceId: string }[]) {
  return mappings
    .map((m) => [m.provider, m.sourceId] as const)
    .sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
    )
    .flatMap(([provider, sourceId], index) => [
      `mapping:${index}:provider:${provider}`,
      `mapping:${index}:source:${sourceId}`,
    ]);
}
export const aliasKey = (v: string) =>
  v.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
export function semantic(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semantic).sort().join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => `${JSON.stringify(k)}:${semantic(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function ordered(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(ordered).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${ordered(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const entityKey = (e: Pick<EntityInput, "kind" | "mapNamespace" | "key">) =>
  JSON.stringify([e.kind, e.mapNamespace, e.key]);
export class CatalogInputError extends Error {
  constructor(readonly code = "invalid_artifact") {
    super(code);
  }
}
export function parseArtifact(bytes: Uint8Array): Artifact {
  let artifact: Artifact;
  try {
    const source = Buffer.from(bytes).toString("utf8");
    if (!Buffer.from(source).equals(Buffer.from(bytes))) throw new Error();
    artifact = artifactSchema.parse(JSON.parse(source));
  } catch {
    throw new CatalogInputError();
  }
  const packs = new Map(artifact.packs.map((p) => [p.packId, p]));
  if (packs.size !== artifact.packs.length || !packs.has("base"))
    throw new CatalogInputError("invalid_coverage");
  const entities = new Map(artifact.entities.map((e) => [entityKey(e), e]));
  if (entities.size !== artifact.entities.length) throw new CatalogInputError("duplicate_entity");
  const mappings = new Set<string>();
  for (const e of artifact.entities) {
    const pack = packs.get(e.packId);
    if (pack?.state !== "validated" || !pack.contributionKinds.includes(e.kind))
      throw new CatalogInputError("invalid_pack_contribution");
    if (e.cargoUnitMassKg !== null && e.kind !== "cargo")
      throw new CatalogInputError("invalid_typed_fact");
    const relations = [
      ["region", e.regionKey, ["city"]],
      ["adr_category", e.adrCategoryKey, ["cargo"]],
      ["trailer_body_type", e.trailerBodyTypeKey, ["trailer_type"]],
      ["trailer_chain_type", e.trailerChainTypeKey, ["trailer_type"]],
    ] as const;
    for (const [kind, key, allowed] of relations)
      if (key !== null) {
        if (
          !(allowed as readonly string[]).includes(e.kind) ||
          !entities.has(JSON.stringify([kind, e.mapNamespace, key]))
        )
          throw new CatalogInputError("invalid_relation");
      }
    for (const a of e.aliases)
      if (
        a.regionKey !== null &&
        (a.regionKey !== e.regionKey ||
          !entities.has(JSON.stringify(["region", e.mapNamespace, a.regionKey])))
      )
        throw new CatalogInputError("invalid_alias_scope");
    const aliases = e.aliases.map((a) =>
      JSON.stringify([a.locale, aliasKey(a.label), a.regionKey]),
    );
    if (new Set(aliases).size !== aliases.length) throw new CatalogInputError("duplicate_alias");
    for (const m of e.mappings) {
      const key = JSON.stringify([e.kind, e.mapNamespace, m.provider, m.sourceId]);
      if (mappings.has(key)) throw new CatalogInputError("duplicate_mapping");
      mappings.add(key);
    }
  }
  for (const p of artifact.packs) {
    if (
      new Set(p.contributionKinds).size !== p.contributionKinds.length ||
      (p.state === "non_contributing" && p.contributionKinds.length > 0)
    )
      throw new CatalogInputError("invalid_coverage");
    if (
      p.state === "validated" &&
      p.contributionKinds.some(
        (k) => !artifact.entities.some((e) => e.packId === p.packId && e.kind === k),
      )
    )
      throw new CatalogInputError("unproven_contribution");
  }
  for (const issue of artifact.mappingIssues) {
    if (
      new Set(issue.candidateKeys).size !== issue.candidateKeys.length ||
      issue.candidateKeys.some(
        (key) => !entities.has(JSON.stringify([issue.kind, issue.mapNamespace, key])),
      )
    )
      throw new CatalogInputError("invalid_mapping_issue");
  }
  return artifact;
}
export const trustedEvidenceSchema = z.strictObject({
  artifactSha256: z.string().regex(/^[0-9a-f]{64}$/),
  game: z.enum(["ets2", "ats"]),
  gameBuild: exact,
  releaseInventoryAsOf: z.iso.date(),
  expectedPacks: z.array(code).min(1).max(512),
  provenance: z.array(provenanceSchema).min(1).max(64),
  englishLabelsReviewed: z.literal(true),
});
export interface CatalogConfig {
  production: boolean;
  synthetic: boolean;
  cursorKey: string;
  maxFileBytes: number;
  artifactTtlMs: number;
  policyRevision: number;
  evidence: z.infer<typeof trustedEvidenceSchema>[];
}
export function validateCatalogConfig(c: CatalogConfig) {
  if (
    !c ||
    typeof c.production !== "boolean" ||
    typeof c.synthetic !== "boolean" ||
    (c.production && c.synthetic) ||
    !/^[0-9a-f]{64}$/.test(c.cursorKey) ||
    !Number.isSafeInteger(c.maxFileBytes) ||
    c.maxFileBytes < 1 ||
    c.maxFileBytes > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(c.artifactTtlMs) ||
    c.artifactTtlMs < 60000 ||
    c.artifactTtlMs > 7 * 86400000 ||
    !Number.isSafeInteger(c.policyRevision) ||
    c.policyRevision < 1
  )
    throw new Error("INVALID_CATALOG_CONFIG");
  z.array(trustedEvidenceSchema).max(128).parse(c.evidence);
}
export function gates(a: Artifact, sha256: string, c: CatalogConfig) {
  const trusted = c.evidence.find(
    (e) =>
      e.artifactSha256 === sha256 &&
      e.game === a.game &&
      e.gameBuild === a.gameBuild &&
      e.releaseInventoryAsOf === a.releaseInventoryAsOf &&
      semantic(e.expectedPacks) === semantic(a.packs.map((p) => p.packId)) &&
      semantic(e.provenance) === semantic(a.provenance),
  );
  const synthetic = c.synthetic && !c.production && a.synthetic;
  return {
    coverageComplete:
      (synthetic || !!trusted) &&
      a.packs.every((p) => ["validated", "non_contributing"].includes(p.state)),
    englishLabelsComplete:
      a.entities.every((e) => e.labels.en !== null) && (synthetic || !!trusted),
    sourceReviewComplete: synthetic || (!a.synthetic && !!trusted),
  };
}
export function cursorCodec(key: string) {
  const sign = (s: string) =>
    createHmac("sha256", Buffer.from(key, "hex")).update("catalogs/cursor/v1\0").update(s).digest();
  return {
    write(binding: unknown, after: string) {
      const data = Buffer.from(JSON.stringify({ binding: hash(ordered(binding)), after })).toString(
        "base64url",
      );
      return `${data}.${sign(data).toString("base64url")}`;
    },
    read(binding: unknown, cursor: string) {
      try {
        if (cursor.length > 2048) throw new Error();
        const [data, mac, extra] = cursor.split(".");
        if (!data || !mac || extra || !timingSafeEqual(sign(data), Buffer.from(mac, "base64url")))
          throw new Error();
        const parsed = z
          .strictObject({ binding: z.string(), after: z.string().max(256) })
          .parse(JSON.parse(Buffer.from(data, "base64url").toString()));
        if (parsed.binding !== hash(ordered(binding))) throw new Error();
        return parsed.after;
      } catch {
        throw new CatalogInputError("invalid_cursor");
      }
    },
  };
}
