import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";

export function probeIdentity(lane: string) {
  return `VTC008_${lane.toUpperCase()}_ASSERTION_PROBE`;
}

export function deliberateFailure(lane: string): never {
  assert.fail(`${probeIdentity(lane)}: deliberate assertion reached`);
}

export function isDeliberateFailure(
  lane: string,
  result: { code: number; output: string },
): boolean {
  // A title or source codeframe is not evidence that the deliberate assertion executed.
  const output = stripVTControlCharacters(result.output);
  const message = `${probeIdentity(lane)}: deliberate assertion reached`;
  const diagnostics = [`AssertionError: ${message}`, `AssertionError [ERR_ASSERTION]: ${message}`];
  return (
    result.code === 1 && output.split(/\r?\n/).some((line) => diagnostics.includes(line.trim()))
  );
}
