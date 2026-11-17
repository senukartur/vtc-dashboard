// Pure view model of the author's trip page blocks added in Stage 4 (VTC-146).
import type { DTO } from "./transport.js";

/** Translation key ("trips" namespace) of a source's persisted outcome. */
export function sourceOutcomeKey(state: DTO["TripStage4Source"]["state"]) {
  return state === "open" ? "outcomeOpen" : state;
}

/** Cargo damage of the effective fact; unknown stays null and is never shown as zero. */
export function damageValue(facts: DTO["EffectiveTripFacts"] | null | undefined): number | null {
  const value = facts?.cargoDamagePercent;
  return typeof value === "number" ? value : null;
}
