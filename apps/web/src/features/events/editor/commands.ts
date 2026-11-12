import { useCallback, useEffect, useRef, useState } from "react";
import { AccountFailure } from "../../account/transport.js";
import type { DTO } from "../model.js";
import { useEventStage2Command } from "../stage-2-queries.js";
import type { EventStage2Command, EventStage2Envelope } from "../stage-2-transport.js";
import { EventFailure } from "../transport.js";

type Receipt<K extends EventStage2Envelope> = { data: DTO[K]; etag: string };
export type EditorStep<K extends EventStage2Envelope> = {
  request: EventStage2Command<K>;
  commit: (receipt: Receipt<K>) => EditorStep<K> | undefined;
};

export function eventEditorAccessLost(error: unknown) {
  return (
    error instanceof AccountFailure &&
    (error.kind === "unauthorized" ||
      error.kind === "forbidden" ||
      (error instanceof EventFailure && error.status === 404))
  );
}

export function useEditorCommands<K extends EventStage2Envelope>() {
  const transport = useEventStage2Command<K>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const [retry, setRetry] = useState<EditorStep<K> | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setTimeout(() => setWaitUntil(0), Math.max(0, waitUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [waitUntil]);

  async function run(step: EditorStep<K>) {
    if (running.current || waitUntil > Date.now()) return;
    running.current = true;
    setPending(true);
    setFailure(null);
    setRetry(null);
    let current: EditorStep<K> | undefined = step;
    try {
      while (current) {
        const receipt = await transport.run(current.request);
        current = current.commit(receipt);
      }
    } catch (error) {
      const reason = error instanceof AccountFailure ? error : new AccountFailure("uncertain");
      setFailure(reason);
      if (
        ["uncertain", "unavailable", "limited"].includes(reason.kind) &&
        !eventEditorAccessLost(reason) &&
        current
      ) {
        setRetry(current);
        if (reason.retryAfter) setWaitUntil(Date.now() + 1000 * reason.retryAfter);
      }
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  const discardRetry = useCallback(() => {
    setRetry(null);
    setWaitUntil(0);
  }, []);

  return {
    pending,
    failure,
    retry,
    coolingDown: !!waitUntil,
    run,
    clearFailure: () => setFailure(null),
    discardRetry,
    retryRequest: () => retry && run(retry),
  };
}
