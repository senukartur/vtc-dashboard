import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { components } from "@vtc/contracts";
import { TransactionCommitOutcomeUnknownError } from "@vtc/db";

type Operation = components["schemas"]["Operation"];
export interface CatalogFixtureDiagnostic {
  event: "catalog_import_fixture";
  phase: "read" | "pass" | "wait" | "completion";
  state:
    | "processing"
    | "completed"
    | "commit_unknown"
    | "idle"
    | "progressed"
    | "failed"
    | "deadline"
    | "aborted";
  elapsedMs: number;
  nativeCodes: string[];
}
interface Ports {
  read(operationId: string): Promise<Operation>;
  pass(signal: AbortSignal): Promise<{ processed: number }>;
}
interface Options {
  deadlineAt: number;
  signal?: AbortSignal;
  now?: () => number;
  observe?: (record: CatalogFixtureDiagnostic) => void;
}
function field(value: unknown, key: string): unknown {
  try {
    return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
  } catch {
    return undefined;
  }
}
function observation(error: unknown) {
  const seen = new Set<unknown>(),
    nativeCodes: string[] = [];
  let unknown = false,
    current = error;
  for (let depth = 0; depth < 8 && current !== undefined && !seen.has(current); depth++) {
    seen.add(current);
    try {
      unknown ||= current instanceof TransactionCommitOutcomeUnknownError;
    } catch {
      /* Hostile prototypes do not establish a typed outcome. */
    }
    const code = field(current, "code");
    if (
      typeof code === "string" &&
      [
        "PROTOCOL_SEQUENCE_TIMEOUT",
        "ETIMEDOUT",
        "ECONNRESET",
        "PROTOCOL_CONNECTION_LOST",
        "ER_LOCK_WAIT_TIMEOUT",
        "ER_LOCK_DEADLOCK",
      ].includes(code) &&
      !nativeCodes.includes(code)
    )
      nativeCodes.push(code);
    current = field(current, "cause");
  }
  return { unknown, nativeCodes };
}

// The operation already exists. This controller has no creation/key or transaction callback port.
export async function completeCatalogImport(
  operationId: string,
  ports: Ports,
  options: Options,
): Promise<Operation & { resultId: string }> {
  const now = options.now ?? (() => performance.now());
  const started = now(),
    controller = new AbortController();
  if (!Number.isFinite(options.deadlineAt)) throw new Error("CATALOG_FIXTURE_INVALID_DEADLINE");
  let expired = now() >= options.deadlineAt;
  const timer = setTimeout(
    () => {
      expired = true;
      controller.abort();
    },
    Math.max(0, options.deadlineAt - now()),
  );
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const emit = (
    phase: CatalogFixtureDiagnostic["phase"],
    state: CatalogFixtureDiagnostic["state"],
    nativeCodes: string[] = [],
  ) => {
    try {
      options.observe?.({
        event: "catalog_import_fixture",
        phase,
        state,
        elapsedMs: Math.max(0, Math.round(now() - started)),
        nativeCodes,
      });
    } catch {
      /* Diagnostics cannot change progression or the original failure. */
    }
  };
  const active = () => {
    if (expired || now() >= options.deadlineAt) throw new Error("CATALOG_FIXTURE_DEADLINE");
    if (signal.aborted) throw new Error("CATALOG_FIXTURE_ABORTED");
  };
  let idle = false;
  try {
    for (;;) {
      active();
      // Await every current read/pass. Deadline rejection alone cannot cancel SQL, and
      // this fixture must not release teardown while an earlier operation is unsettled.
      const operation = await ports.read(operationId);
      active();
      if (operation.id !== operationId) throw new Error("CATALOG_FIXTURE_WRONG_OPERATION");
      if (operation.state === "failed") throw new Error("CATALOG_FIXTURE_OPERATION_FAILED");
      if (operation.state === "completed") {
        if (typeof operation.resultId !== "string" || !operation.resultId)
          throw new Error("CATALOG_FIXTURE_RESULT_MISSING");
        emit("completion", "completed");
        return { ...operation, resultId: operation.resultId };
      }
      if (operation.state !== "processing") throw new Error("CATALOG_FIXTURE_INVALID_STATE");
      emit("read", "processing");
      if (idle) {
        emit("wait", "idle");
        try {
          await delay(Math.min(250, Math.max(1, options.deadlineAt - now())), undefined, {
            signal,
          });
        } catch {
          active();
          throw new Error("CATALOG_FIXTURE_WAIT_FAILED");
        }
        active();
      }
      try {
        const result = await ports.pass(signal);
        idle = result.processed === 0;
        emit("pass", idle ? "idle" : "progressed");
      } catch (error) {
        const observed = observation(error);
        if (!observed.unknown) {
          emit("pass", "failed", observed.nativeCodes);
          throw error;
        }
        emit("pass", "commit_unknown", observed.nativeCodes);
        active();
        idle = false;
        // A fresh owning read decides whether the same operation completed or needs
        // another ordinary durable pass, possibly after its natural claim expiry.
      }
    }
  } catch (error) {
    emit("completion", expired ? "deadline" : signal.aborted ? "aborted" : "failed");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Framework hook timeouts do not cancel promises. Serialize accepted reset/close work,
// retain all started catalog completions, and refuse new work once closing is requested.
export function catalogFixtureLifecycle() {
  let tail: Promise<void> = Promise.resolve(),
    closing = false;
  const pending = new Set<Promise<unknown>>();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async function settle() {
    while (pending.size) await Promise.allSettled([...pending]);
  }
  return {
    track<T>(operation: () => Promise<T>): Promise<T> {
      if (closing) return Promise.reject(new Error("CATALOG_FIXTURE_CLOSING"));
      let work: Promise<T>;
      try {
        work = operation();
      } catch (error) {
        return Promise.reject(error);
      }
      pending.add(work);
      // The original caller retains the original promise and its failure; this observer
      // only records settlement so teardown can drain work without replaying it.
      work.then(
        () => {
          pending.delete(work);
        },
        () => {
          pending.delete(work);
        },
      );
      return work;
    },
    reset<T>(operation: () => Promise<T>): Promise<T> {
      if (closing) return Promise.reject(new Error("CATALOG_FIXTURE_CLOSING"));
      return enqueue(async () => {
        await settle();
        return operation();
      });
    },
    close<T>(operation: () => Promise<T>): Promise<T> {
      if (closing) return Promise.reject(new Error("CATALOG_FIXTURE_CLOSING"));
      closing = true;
      return enqueue(async () => {
        await settle();
        return operation();
      });
    },
  };
}
