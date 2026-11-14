import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useSignOut } from "../account/sign-out.js";
import { useRefreshPromotionReads } from "./promotion-queries.js";
import { type Candidate, promotionInput } from "./promotion-transport.js";
import { useQualificationCommand } from "./queries.js";

export type ReadyCandidate = Candidate & { nextLevel: NonNullable<Candidate["nextLevel"]> };
type Notice = { kind: "committed" | "conflict"; candidate: ReadyCandidate };

const PromotionCommandContext = createContext<ReturnType<typeof usePromotionCommandState> | null>(
  null,
);

export function PromotionCommandProvider({ children }: { children: ReactNode }) {
  const { self, generation } = useSession();
  const signOut = useSignOut();
  if (signOut.active || !self?.capabilities.includes("qualifications.manage")) return children;
  return (
    <AuthorizedPromotionCommand key={`${generation}:${self.member.id}:${self.identityEpoch}`}>
      {children}
    </AuthorizedPromotionCommand>
  );
}

function AuthorizedPromotionCommand({ children }: { children: ReactNode }) {
  const state = usePromotionCommandState();
  return <PromotionCommandContext value={state}>{children}</PromotionCommandContext>;
}

export function usePromotionCommand() {
  const command = useContext(PromotionCommandContext);
  if (!command) throw new Error("PROMOTION_COMMAND_BOUNDARY_MISSING");
  return command;
}

function usePromotionCommandState() {
  const { self } = useSession();
  const location = useLocation();
  const refresh = useRefreshPromotionReads();
  const [openLocation, setOpenLocation] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ReadyCandidate | null>(null);
  const [attemptReason, setAttemptReason] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [changed, setChanged] = useState<{ candidate: ReadyCandidate } | null>(null);
  const [saved, setSaved] = useState<{ candidate: ReadyCandidate; reason: string } | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const refreshNeeded = useRef(false);
  const command = useQualificationCommand(
    candidate
      ? {
          kind: "member",
          game: candidate.game,
          id: candidate.member.id,
          rolePromotionLevelId:
            candidate.member.id === self?.member.id ? candidate.nextLevel.id : null,
        }
      : undefined,
    () => {
      if (!candidate) return;
      // The helper calls this only after validating a receipt or recognizing a conflict.
      refreshNeeded.current = true;
    },
  );

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  if (openLocation !== null && openLocation !== location.key) setOpenLocation(null);
  const open = openLocation === location.key && !!candidate;
  const openPreview = () => setOpenLocation(location.key);

  const held = command.canRecover || command.failure?.kind === "limited";
  const conflict = command.failure?.kind === "conflict";
  const busy = command.pending || finishing;
  const blocked = busy || command.seconds > 0;

  function select(next: ReadyCandidate) {
    if (inFlight.current || held || conflict) return false;
    command.reset();
    setNotice(null);
    setCandidate(next);
    setAttemptReason(null);
    openPreview();
    return true;
  }
  function dismiss() {
    if (inFlight.current || conflict) return;
    setOpenLocation(null);
    if (held) return;
    command.reset();
    setCandidate(null);
    setAttemptReason(null);
  }

  async function submit(reason: string) {
    if (!candidate || !reason || inFlight.current || blocked || conflict) return;
    inFlight.current = true;
    setFinishing(true);
    setAttemptReason(reason);
    refreshNeeded.current = false;
    try {
      const result = await (command.canRecover
        ? command.recover()
        : command.run(
            `/admin/members/${encodeURIComponent(candidate.member.id)}/promotions`,
            promotionInput(candidate, reason),
            "EnvelopeAssignment",
            `"v${candidate.version}"`,
          ));
      // For self-promotion the shared command refreshes /me before returning. Fence reads under
      // both the original and new authority in this session, including first reads after /me.
      if (!active.current) return;
      if (refreshNeeded.current) {
        setChanged({ candidate });
        await refresh(candidate, { committed: !!result });
      }
      if (!active.current || !result) return;
      setNotice({ kind: "committed", candidate });
      setCandidate(null);
      setAttemptReason(null);
      setSaved(null);
    } finally {
      inFlight.current = false;
      if (active.current) setFinishing(false);
    }
  }

  function reviewAgain() {
    if (!candidate || !conflict || inFlight.current) return;
    command.reset();
    setNotice({ kind: "conflict", candidate });
    setSaved({ candidate, reason: attemptReason ?? "" });
    setCandidate(null);
    setAttemptReason(null);
  }

  return {
    candidate,
    open,
    openPreview,
    attemptReason,
    changed,
    notice,
    saved,
    select,
    dismiss,
    submit,
    reviewAgain,
    busy,
    held,
    conflict,
    blocked,
    failure: command.failure,
    canRecover: command.canRecover,
    seconds: command.seconds,
  };
}
