import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { Form } from "./Form.js";
import { useCommand } from "./useCommand.js";

type SignOut = {
  /** True only while an attempt started in the current access generation is unresolved. */
  active: boolean;
  start: () => Promise<void>;
  dismiss: () => void;
  command: ReturnType<typeof useCommand>;
};
const SignOutContext = createContext<SignOut | null>(null);

/** Shell-level sign-out. Never key this by generation: the effect below fences each attempt instead. */
export function SignOutProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const logout = useCommand();
  const { cancel } = logout;
  const lifetime = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState<number | null>(null);
  // The trigger is gone while signing out; main keeps focus across the generation remount.
  const focusMain = useRef(false);
  const generation = session.generation;
  // biome-ignore lint/correctness/useExhaustiveDependencies: each access generation needs a fresh lifetime; the old one is aborted.
  useEffect(() => {
    if (focusMain.current) {
      focusMain.current = false;
      document.getElementById("main-content")?.focus();
    }
    const controller = new AbortController();
    lifetime.current = controller;
    // A new generation (another identity, or a confirmed end) disowns A's logout and probe.
    return () => {
      controller.abort();
      cancel();
    };
  }, [generation, cancel]);
  async function start() {
    const current = lifetime.current;
    if (!current || current.signal.aborted) return;
    setAttempt(generation);
    focusMain.current = true;
    const result = await logout.run("logout", undefined);
    if (current.signal.aborted) return;
    if (result) session.end();
    else await session.confirmSessionLoss(current.signal);
  }
  return (
    <SignOutContext
      value={{
        active: attempt !== null && attempt === generation,
        start,
        dismiss: () => {
          focusMain.current = false;
          setAttempt(null);
        },
        command: logout,
      }}
    >
      {children}
    </SignOutContext>
  );
}
export function useSignOut() {
  const value = useContext(SignOutContext);
  if (!value) throw new Error("SIGN_OUT_BOUNDARY_MISSING");
  return value;
}

/** Replaces private workspace content until sign-out is confirmed or the session is rechecked. */
export function SignOutStatus() {
  const { t } = useTranslation("account");
  const session = useSession();
  const { command, start, dismiss } = useSignOut();
  return (
    <Card className="auth-card stack">
      <h1>{t("logout")}</h1>
      <p role="status">{t(command.pending ? "working" : "logoutUncertain")}</p>
      <Form id="logout" fields={[]} {...command} action="logout" submit={start} />
      <Button
        variant="outline"
        disabled={command.pending}
        onClick={async () => {
          await session.refresh();
          dismiss();
        }}
      >
        {t("checkSession")}
      </Button>
    </Card>
  );
}
