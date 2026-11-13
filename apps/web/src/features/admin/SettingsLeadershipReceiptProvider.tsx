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
import { useLocation, useMatch, useNavigate } from "react-router-dom";
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
const ConfirmationContext = createContext<TransferConfirmation | null>(null);

export function useSettingsTransferConfirmation() {
  return useContext(ConfirmationContext);
}

/** The shell resets notification state when capabilities change, including after a transfer. */
export function SettingsLeadershipReceiptProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const onSettings = useMatch(paths.settings);
  const signOut = useSignOut();
  const [owned, setOwned] = useState<OwnedConfirmation | null>(null);
  const account = session.self;
  const scope =
    onSettings && account && session.state === "authenticated" && !signOut.active
      ? JSON.stringify([account.member.id, account.identityEpoch, session.generation])
      : null;
  return (
    <ConfirmationContext value={owned?.scope === scope ? owned.value : null}>
      {scope && <SettingsTransferOwner key={scope} scope={scope} publish={setOwned} />}
      {children}
    </ConfirmationContext>
  );
}

// Publishing the current command updates the context, independent of the command owner.
const SettingsTransferOwner = memo(function SettingsTransferOwner({
  scope,
  publish,
}: {
  scope: string;
  publish: (value: OwnedConfirmation | null) => void;
}) {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const currentLocation = useRef<typeof location | null>(null);
  const command = useWorkspaceCommand();
  useLayoutEffect(() => {
    currentLocation.current = location;
    return () => {
      currentLocation.current = null;
    };
  }, [location]);

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
    if (!result || !currentLocation.current) return false;
    const { pathname, search, hash } = currentLocation.current;
    navigate(
      { pathname, search, hash },
      { replace: true, state: { leadershipTransferredTo: nickname } },
    );
    session.changed();
    return true;
  }

  useLayoutEffect(() => {
    publish({ scope, value: { command, submit } });
  });
  useLayoutEffect(() => () => publish(null), [publish]);
  return null;
});
