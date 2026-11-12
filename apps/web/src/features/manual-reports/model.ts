import { canonicalDecimal, schema } from "../trips/transport.js";

/** Display-only reasons why a manual report cannot be submitted yet, in field order. */
export const requirements = [
  "origin",
  "destination",
  "originCompanyId",
  "destinationCompanyId",
  "cargo",
  "trailerType",
  "cargoMassKg",
  "actualDistanceM",
  "startedAt",
  "completedAt",
  "cargoDamagePercent",
  "evidence",
  "invalid",
] as const;
export type Requirement = (typeof requirements)[number];

const fieldRequirement: Record<string, Requirement> = {
  ...Object.fromEntries(requirements.map((name) => [name, name])),
  evidenceIds: "evidence",
};

export const referenceFields = [
  "startedAt",
  "completedAt",
  "cargoDamagePercent",
  "originCompanyId",
  "destinationCompanyId",
] as const;

export function formatDamage(value: number, locale: "en" | "ru"): string {
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumSignificantDigits: 21,
  }).format(value);
}

export function damagePercent(text: string): number | undefined {
  const decimal = canonicalDecimal(text);
  if (decimal === undefined) return undefined;
  const [integer = "", fraction] = decimal.split(".");
  // Compare the upper bound before Number conversion can round a value down to 100.
  if (integer.length > 3 || Number(integer) > 100 || (integer === "100" && fraction))
    return undefined;
  return Number(decimal);
}

export function submissionTimeErrors(
  startedAt: string | undefined,
  completedAt: string | undefined,
  now: number,
) {
  const start = startedAt === undefined ? undefined : Date.parse(startedAt);
  const end = completedAt === undefined ? undefined : Date.parse(completedAt);
  return {
    startedAt: start !== undefined && start > now ? ("referenceFuture" as const) : undefined,
    completedAt:
      end !== undefined && end > now
        ? ("referenceFuture" as const)
        : start !== undefined && end !== undefined && start >= end
          ? ("referenceOrder" as const)
          : undefined,
  };
}

/** Maps generated final-write validation and local guards to the passive requirements list. */
export function missingRequirements(
  submission: unknown,
  ready: boolean,
  localIssues: readonly Requirement[] = [],
): Requirement[] {
  const found = new Set<Requirement>(localIssues);
  const result = schema("ManualDatedSubmissionFields").safeParse(submission);
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
