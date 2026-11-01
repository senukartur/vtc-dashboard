// Pure presentation helpers for the catalog review screens. They derive display state from
// returned DTOs only; the server remains authoritative for every publication decision.
import type { CatalogDTO, Game } from "../../shared/catalog-selectors/contracts.js";

type Revision = CatalogDTO["CatalogRevision"];
type Review = CatalogDTO["CatalogReview"];
type Change = CatalogDTO["CatalogEntityChange"];
type FieldValue = CatalogDTO["CatalogFieldChange"]["after"];

export const renderValue = (value: FieldValue) =>
  value === null ? "∅" : Array.isArray(value) ? value.join(" · ") : String(value);

/** Reviewed English label returned in this change, if any; callers fall back to the ID. */
export function entityLabel(change: Change): string | null {
  const field = change.fields.find((f) => f.field === "label_en");
  return typeof field?.after === "string" ? field.after : null;
}

export type LabelValue = { returned: false } | { returned: true; value: string | null };
/** Returned label fields of one change; `null` means no label change was returned at all. */
export function labelChange(change: Change): { en: LabelValue; ru: LabelValue } | null {
  const pick = (name: "label_en" | "label_ru"): LabelValue => {
    const field = change.fields.find((f) => f.field === name);
    if (!field) return { returned: false };
    return { returned: true, value: typeof field.after === "string" ? field.after : null };
  };
  const en = pick("label_en"),
    ru = pick("label_ru");
  return en.returned || ru.returned ? { en, ru } : null;
}

export type PublishBlocker =
  | { kind: "unavailable" }
  | { kind: "version" }
  | { kind: "state"; state: Revision["state"] }
  | { kind: "coverage"; problems: number }
  | { kind: "english" }
  | { kind: "source"; state: Review["sourceReviewState"] }
  | { kind: "mappings"; count: number };

export const packProblems = (review: Review) => review.missingPacks + review.failedPacks;
export const changeCount = (review: Review) =>
  review.addedEntities + review.changedEntities + review.retiredEntities;

/** Blockers in a fixed display order; an empty list is exactly the previous publication gate. */
export function publishBlockers(
  revision: Revision | undefined,
  review: Review | undefined,
): PublishBlocker[] {
  if (!revision || !review) return [{ kind: "unavailable" }];
  const blockers: PublishBlocker[] = [];
  if (revision.version !== review.version) blockers.push({ kind: "version" });
  if (revision.state !== "draft") blockers.push({ kind: "state", state: revision.state });
  if (!revision.coverageComplete)
    blockers.push({ kind: "coverage", problems: packProblems(review) });
  if (!revision.englishLabelsComplete) blockers.push({ kind: "english" });
  if (!revision.sourceReviewComplete)
    blockers.push({ kind: "source", state: review.sourceReviewState });
  if (review.mappingIssues !== 0) blockers.push({ kind: "mappings", count: review.mappingIssues });
  return blockers;
}
export const canPublish = (revision: Revision | undefined, review: Review | undefined) =>
  publishBlockers(revision, review).length === 0;

export type StepState = "done" | "current" | "failed" | "pending";
export type ImportStep = { id: "uploaded" | "imported" | "ready"; state: StepState };
/**
 * Upload → import → review progress. A freshly stored artifact takes precedence over an older
 * operation in the URL because it starts a new attempt. `operation` is the returned operation
 * state, or `"unknown"` while a recovered operation ID is still loading.
 */
export function importSteps(
  artifact: CatalogDTO["CatalogArtifact"]["state"] | undefined,
  operation: CatalogDTO["Operation"]["state"] | "unknown" | undefined,
): ImportStep[] {
  const steps = (uploaded: StepState, imported: StepState, ready: StepState): ImportStep[] => [
    { id: "uploaded", state: uploaded },
    { id: "imported", state: imported },
    { id: "ready", state: ready },
  ];
  if (artifact === "processing") return steps("current", "pending", "pending");
  if (artifact === "rejected") return steps("failed", "pending", "pending");
  if (artifact === "ready") return steps("done", "current", "pending");
  if (operation === "completed") return steps("done", "done", "done");
  if (operation === "failed") return steps("done", "failed", "pending");
  if (operation) return steps("done", "current", "pending");
  return steps("pending", "pending", "pending");
}

export type RevisionStatus = "current" | "replaced" | "draft" | "validated" | "rejected";
export type RevisionRow = { revision: Revision; status: RevisionStatus };
/** Published revisions (current first) plus the open candidate when it is unpublished. */
export function revisionRows(
  published: readonly Revision[],
  candidate: Revision | undefined,
  game: Game,
): RevisionRow[] {
  const rows: RevisionRow[] = published.map((revision, index) => ({
    revision,
    status: index === 0 ? "current" : "replaced",
  }));
  if (
    candidate &&
    candidate.game === game &&
    candidate.state !== "published" &&
    !published.some((revision) => revision.id === candidate.id)
  )
    rows.unshift({ revision: candidate, status: candidate.state });
  return rows;
}

export type Tone = "accepted" | "pending" | "destructive" | "neutral" | "preview";
const tones: Record<string, { tone: Tone; glyph: string }> = {
  current: { tone: "accepted", glyph: "✓" },
  published: { tone: "accepted", glyph: "✓" },
  validated: { tone: "accepted", glyph: "✓" },
  approved: { tone: "accepted", glyph: "✓" },
  added: { tone: "accepted", glyph: "+" },
  draft: { tone: "pending", glyph: "●" },
  pending: { tone: "pending", glyph: "●" },
  changed: { tone: "preview", glyph: "~" },
  rejected: { tone: "destructive", glyph: "✕" },
  missing: { tone: "destructive", glyph: "✕" },
  failed: { tone: "destructive", glyph: "✕" },
  replaced: { tone: "neutral", glyph: "—" },
  non_contributing: { tone: "neutral", glyph: "—" },
  retired: { tone: "neutral", glyph: "−" },
};
/** Tone plus a glyph so state never depends on colour alone; text always carries the meaning. */
export const stateTone = (state: string) => tones[state] ?? { tone: "neutral" as Tone, glyph: "•" };
