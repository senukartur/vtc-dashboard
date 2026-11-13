import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMatch } from "react-router-dom";
import { paths } from "../../app/navigation-model.js";
import { useSession } from "../../app/Session.js";
import { useSignOut } from "../account/sign-out.js";
import { useWorkspaceCommand } from "./transport.js";

export type TransferConfirmation = {
  command: ReturnType<typeof useWorkspaceCommand>;
  submit: (challengeId: string, code: string, nickname: string) => Promise<boolean>;
};
type OwnedConfirmation = {
  scope: string;
  value: TransferConfirmation;
};
type TransferNotice = {
  nickname: string;
  identity: string;
  generation: number;
};
const ConfirmationContext = createContext<TransferConfirmation | null>(null);
const NoticeContext = createContext<{ nickname: string | null; dismiss: () => void }>({
  nickname: null,
  dismiss: () => {},
});

export function useSettingsTransferConfirmation() {
  return useContext(ConfirmationContext);
}

export function useSettingsTransferNotice() {
  return useContext(NoticeContext);
}

/** The shell resets notification state when capabilities change, including after a transfer. */
export function SettingsLeadershipReceiptProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const onSettings = useMatch(paths.settings);
  const signOut = useSignOut();
  const [owned, setOwned] = useState<OwnedConfirmation | null>(null);
  const [notice, setNotice] = useState<TransferNotice | null>(null);
  const { self: account, state, generation } = session;
  const identity = account ? JSON.stringify([account.member.id, account.identityEpoch]) : null;
  const inWorkspace = !!onSettings && !signOut.active;
  const scope = inWorkspace && identity ? JSON.stringify([identity, generation]) : null;
  // Keep the notice only through the one intentional session refresh triggered by success.
  const noticeMatches =
    notice &&
    inWorkspace &&
    (generation === notice.generation || generation === notice.generation + 1) &&
    (state === "checking" || (state === "authenticated" && identity === notice.identity));
  if (notice && !noticeMatches) setNotice(null);
  const nickname = noticeMatches && state === "authenticated" ? notice.nickname : null;
  return (
    <ConfirmationContext value={owned?.scope === scope ? owned.value : null}>
      {scope && identity && (
        <SettingsTransferOwner
          key={scope}
          scope={scope}
          identity={identity}
          publish={setOwned}
          announce={setNotice}
        />
      )}
      <NoticeContext value={{ nickname, dismiss: () => setNotice(null) }}>{children}</NoticeContext>
    </ConfirmationContext>
  );
}

// Publishing the current command updates the context, independent of the command owner.
const SettingsTransferOwner = memo(function SettingsTransferOwner({
  scope,
  identity,
  publish,
  announce,
}: {
  scope: string;
  identity: string;
  publish: (value: OwnedConfirmation | null) => void;
  announce: (notice: TransferNotice) => void;
}) {
  const session = useSession();
  const active = useRef(false);
  const command = useWorkspaceCommand();
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const capabilities = session.self?.capabilities;
  const canTransfer =
    session.self?.emailVerified &&
    capabilities?.includes("company.configure") &&
    capabilities.includes("leadership.transfer") &&
    capabilities.includes("members.manage");
  useEffect(() => {
    // Allow the current response to settle, but release a frozen retry after access is lost.
    if (!canTransfer && command.held && !command.pending) command.dismiss();
  }, [canTransfer, command]);

  async function submit(challengeId: string, code: string, nickname: string) {
    if (!canTransfer) return false;
    const result = await command.run(
      "/admin/leadership/transfers",
      "EnvelopeCommandResult",
      { challengeId, code },
      null,
      "POST",
      false,
    );
    if (!result || !active.current) return false;
    announce({ nickname, identity, generation: session.generation });
    session.changed();
    return true;
  }

  useLayoutEffect(() => {
    publish({ scope, value: { command, submit } });
  });
  useLayoutEffect(() => () => publish(null), [publish]);
  return null;
});
