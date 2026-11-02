import { schema } from "../trips/transport.js";

/** Display-only reasons why a manual report cannot be submitted yet, in field order. */
export const requirements = [
  "origin",
  "destination",
  "cargo",
  "trailerType",
  "cargoMassKg",
  "actualDistanceM",
  "evidence",
  "invalid",
] as const;
export type Requirement = (typeof requirements)[number];

const fieldRequirement: Record<string, Requirement> = {
  origin: "origin",
  destination: "destination",
  cargo: "cargo",
  trailerType: "trailerType",
  cargoMassKg: "cargoMassKg",
  actualDistanceM: "actualDistanceM",
  evidenceIds: "evidence",
};

/**
 * Maps the generated ManualSubmissionFields validation and the evidence readiness to a passive
 * requirements list. The editor's `complete` flag stays authoritative; any unmapped issue becomes
 * "invalid", so the list is never empty while the form is incomplete.
 */
export function missingRequirements(submission: unknown, ready: boolean): Requirement[] {
  const found = new Set<Requirement>();
  const result = schema("ManualSubmissionFields").safeParse(submission);
  if (!result.success)
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "");
      found.add(
        Object.hasOwn(fieldRequirement, key) ? (fieldRequirement[key] ?? "invalid") : "invalid",
      );
    }
  if (!ready) found.add("evidence");
  return requirements.filter((item) => found.has(item));
}
