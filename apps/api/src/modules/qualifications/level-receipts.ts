import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import { closed } from "../../platform/outbox/events.js";
import { decimal } from "../sources/contracts/canonical.js";
import { structuralLevels } from "./initialization.js";

type LevelDto = components["schemas"]["QualificationLevel"];
const legacyOrder = ["trainee", "driver_iii", "driver_ii", "driver_i"];

// Existing command scopes/fingerprints stay valid for the original receipt lifetime.
export function levelReceipt(raw: Record<string, unknown>, levelId: string) {
  const { data, version } = closed(raw, ["data", "version"]);
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1)
    throw new Error("INVALID_QUALIFICATION_RECEIPT");
  if (data && typeof data === "object" && !Object.hasOwn(data, "code")) {
    const stored = closed(data, [
      "id",
      "game",
      "name",
      "ruleVersionId",
      "configured",
      "requiredTrips",
      "requiredDistanceM",
      "version",
      "position",
      "terminal",
      "promotionConfigured",
      ...(Object.hasOwn(data, "freightRuleSummary") ? ["freightRuleSummary"] : []),
    ]);
    if (
      stored.id !== levelId ||
      stored.version !== version ||
      (stored.game !== "ets2" && stored.game !== "ats")
    )
      throw new Error("INVALID_QUALIFICATION_RECEIPT");
    return {
      data: { freightRuleSummary: null, ...stored } as LevelDto,
      version,
    };
  }

  const {
    id,
    game,
    code,
    name,
    ruleVersionId,
    configured,
    requiredTrips,
    requiredDistanceM,
    version: levelVersion,
  } = closed(data, [
    "id",
    "game",
    "code",
    "name",
    "ruleVersionId",
    "configured",
    "requiredTrips",
    "requiredDistanceM",
    "version",
  ]);
  const position = typeof code === "string" ? legacyOrder.indexOf(code) + 1 : 0;
  if (
    id !== levelId ||
    (game !== "ets2" && game !== "ats") ||
    !position ||
    structuralLevels[game][position - 1] !== id ||
    levelVersion !== version ||
    typeof name !== "string" ||
    !name.trim() ||
    [...name].length > 128 ||
    typeof configured !== "boolean" ||
    configured !== (ruleVersionId !== null) ||
    (ruleVersionId !== null &&
      (typeof ruleVersionId !== "string" || applicationId(ruleVersionId) !== ruleVersionId)) ||
    (requiredTrips !== null &&
      (typeof requiredTrips !== "number" ||
        !Number.isSafeInteger(requiredTrips) ||
        requiredTrips < 0)) ||
    (requiredDistanceM !== null &&
      (typeof requiredDistanceM !== "string" ||
        decimal(requiredDistanceM) !== requiredDistanceM)) ||
    (!configured && (requiredTrips !== null || requiredDistanceM !== null))
  )
    throw new Error("INVALID_QUALIFICATION_RECEIPT");
  const terminal = position === legacyOrder.length;
  return {
    version,
    data: {
      id,
      game,
      version,
      position,
      terminal,
      name,
      ruleVersionId,
      configured,
      freightRuleSummary: null,
      promotionConfigured: configured && !terminal,
      requiredTrips: terminal ? null : requiredTrips,
      requiredDistanceM: terminal ? null : requiredDistanceM,
    } satisfies LevelDto,
  };
}
