import { browserProjects } from "../../scripts/browser-diagnostics.mjs";
import { collectEvents } from "../../scripts/ci-result.mjs";

export function browserFailureProof(output: string) {
  const collector = collectEvents();
  collector.push(output);
  const failures = collector.browserFailures;
  if (
    failures.length !== browserProjects.length ||
    !browserProjects.every((project) =>
      failures.some(
        (failure) =>
          failure.kind === "test" &&
          failure.file === "assertion-probe" &&
          failure.project === project &&
          failure.status === "failed",
      ),
    )
  )
    throw new Error("FAILURE_PROBE_BROWSER_DIAGNOSTICS_INVALID");
  return failures;
}
