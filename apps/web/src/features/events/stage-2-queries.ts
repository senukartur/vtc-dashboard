import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useSession } from "../../app/Session.js";
import { AccountFailure } from "../account/transport.js";
import { eventStage2ImageQueryPolicy, visibleEventStage2Image } from "./stage-2-model.js";
import {
  type EventStage2Access,
  type EventStage2Command,
  type EventStage2Content,
  type EventStage2Envelope,
  type EventStage2Read,
  readEventStage2,
  readEventStage2Content,
  sendEventStage2,
} from "./stage-2-transport.js";

const prefix = "events-stage-2";
type Session = ReturnType<typeof useSession>;

function sessionScope(session: Session) {
  const self = session.self;
  return self
    ? JSON.stringify([self.member.id, session.generation, self.identityEpoch, self.capabilities])
    : null;
}

function hasAccess(session: Session, access: EventStage2Access) {
  return access === "public" || session.self?.capabilities.includes(access) === true;
}

async function refreshAccess(
  failure: unknown,
  signal: AbortSignal,
  session: Session,
  client: ReturnType<typeof useQueryClient>,
) {
  if (signal.aborted || !(failure instanceof AccountFailure)) return;
  if (failure.kind === "unauthorized") await session.confirmSessionLoss(signal);
  if (failure.kind === "forbidden") {
    client.removeQueries({ type: "inactive", predicate: (query) => query.meta?.private === true });
    await session.refresh();
  }
}

function useStage2Read<T>(
  spec: { path: string; access: EventStage2Access },
  name: string,
  read: (signal: AbortSignal) => Promise<T>,
  enabled: boolean,
  image = false,
) {
  const session = useSession();
  const client = useQueryClient();
  const publicRead = spec.access === "public";
  const allowed = hasAccess(session, spec.access);
  const query = useQuery({
    queryKey: [prefix, publicRead ? "public" : sessionScope(session), spec.access, spec.path, name],
    meta: { private: !publicRead },
    enabled: enabled && allowed,
    retry: false,
    ...(image
      ? eventStage2ImageQueryPolicy
      : { gcTime: publicRead ? 300000 : 0, staleTime: 30000 }),
    queryFn: async ({ signal }) => {
      try {
        return await read(signal);
      } catch (failure) {
        if (!publicRead) await refreshAccess(failure, signal, session, client);
        throw failure;
      }
    },
  });
  return { query, allowed };
}

export function useEventStage2Query<K extends EventStage2Envelope>(
  spec: EventStage2Read<K>,
  enabled = true,
) {
  const { query, allowed } = useStage2Read(
    spec,
    spec.schema,
    (signal) => readEventStage2(spec, signal),
    enabled,
  );
  return { ...query, data: query.isError || !allowed ? undefined : query.data };
}

export function useEventStage2Image(spec: EventStage2Content, enabled = true) {
  const { query, allowed } = useStage2Read(
    spec,
    "image",
    (signal) => readEventStage2Content(spec, signal),
    enabled,
    true,
  );
  const canFetch = enabled && allowed;
  return {
    data: visibleEventStage2Image(query, canFetch),
    error: query.error,
    isError: query.isError,
    isFetching: query.isFetching,
    isPending: query.isPending,
    refetch: async () => {
      if (canFetch) await query.refetch();
    },
  };
}

export function useEventStage2Command<K extends EventStage2Envelope>() {
  const session = useSession();
  const client = useQueryClient();
  const scope = sessionScope(session);
  const inFlight = useRef<AbortController | null>(null);

  function invalidate() {
    return client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === prefix &&
        (query.queryKey[1] === scope || query.queryKey[1] === "public"),
    });
  }

  const mutation = useMutation({
    mutationKey: [prefix, scope, "command"],
    retry: false,
    gcTime: 0,
    mutationFn: async (command: EventStage2Command<K>) => {
      if (!hasAccess(session, "events.manage")) throw new AccountFailure("forbidden");
      if (inFlight.current) throw new AccountFailure("conflict");
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const result = await sendEventStage2(command, controller.signal);
        await invalidate();
        controller.signal.throwIfAborted();
        return result;
      } catch (failure) {
        await refreshAccess(failure, controller.signal, session, client);
        if (failure instanceof AccountFailure && failure.kind === "conflict") await invalidate();
        throw failure;
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
    },
  });
  const { reset } = mutation;
  // A prepared attempt is supplied again by the caller on retry. Changing
  // account or capabilities aborts work from the previous session scope.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the access scope is the cleanup trigger
  useEffect(() => {
    reset();
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [scope, reset]);

  return {
    run: mutation.mutateAsync,
    pending: mutation.isPending,
    failure: mutation.error instanceof AccountFailure ? mutation.error : null,
  };
}
