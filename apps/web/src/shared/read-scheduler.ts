// Two browser reads leave room for a paired session and a guarded write in the API's existing five-slot pool.
// This is transient scheduling, not a cache or an authorization decision.
let active = 0;
const waiting: { signal: AbortSignal; start: () => void; cancel: () => void }[] = [];
function drain() {
  while (active < 2 && waiting.length) {
    const next = waiting.shift();
    if (next && !next.signal.aborted) next.start();
  }
}
export async function withReadSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const entry = {
      signal,
      start: () => {
        signal.removeEventListener("abort", entry.cancel);
        active++;
        resolve();
      },
      cancel: () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason);
      },
    };
    signal.addEventListener("abort", entry.cancel, { once: true });
    waiting.push(entry);
    drain();
  });
  try {
    signal.throwIfAborted();
    return await work();
  } finally {
    active--;
    drain();
  }
}
