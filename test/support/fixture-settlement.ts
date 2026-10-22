import type { ChildProcess } from "node:child_process";

export function fixtureSettlement() {
  const pending = new Set<Promise<unknown>>();
  return {
    track<T>(work: Promise<T>): Promise<T> {
      pending.add(work);
      const remove = () => pending.delete(work);
      void work.then(remove, remove);
      return work;
    },
    async wait() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

// A process exit does not imply that its receipt streams have drained. Spawn and
// stream errors remain failures, but their owner must still await child close.
export function childClose(child: ChildProcess) {
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    spawnFailed: boolean;
    streamFailed: boolean;
  }>((resolve) => {
    let spawnFailed = false,
      streamFailed = false;
    const onError = () => {
      spawnFailed = true;
    };
    const onStreamError = () => {
      streamFailed = true;
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      child.off("error", onError);
      child.stdout?.off("error", onStreamError);
      child.stderr?.off("error", onStreamError);
      resolve({ code, signal, spawnFailed, streamFailed });
    };
    child.once("error", onError);
    child.stdout?.on("error", onStreamError);
    child.stderr?.on("error", onStreamError);
    child.once("close", onClose);
  });
}
