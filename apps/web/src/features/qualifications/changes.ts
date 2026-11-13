import { AccountFailure } from "../account/transport.js";
import { type DTO, type Game, schema } from "./transport.js";

export type CommandOwner =
  | { kind: "ladder"; game: Game }
  | { kind: "level"; id: string; game: Game }
  | { kind: "member"; id: string; game: Game; rolePromotionLevelId: string | null };
export type Change =
  | { kind: "ladder"; game: Game; archive: boolean }
  | { kind: "level"; id: string; game: Game }
  | { kind: "member"; id: string; game: Game; levelId: string; roleChange: boolean };
const uncertain = () => new AccountFailure("uncertain");
export function commandChange(
  owner: CommandOwner | undefined,
  path: string,
  body: unknown,
  method: string,
): Change | null {
  if (path === "/admin/qualification-rule-previews" && method === "POST" && !owner) return null;
  if (!owner || !body || typeof body !== "object") throw uncertain();
  if (owner.kind === "ladder") {
    const root = `/admin/qualification-ladders/${owner.game}`;
    if (
      (method === "PATCH" && path === `${root}/order`) ||
      (method === "POST" &&
        (path === `${root}/levels` ||
          (path.startsWith(`${root}/levels/`) && path.endsWith("/archive"))))
    )
      return { kind: "ladder", game: owner.game, archive: path.endsWith("/archive") };
    throw uncertain();
  }
  if (
    owner.kind === "level" &&
    ((path === `/admin/qualification-levels/${owner.id}` && method === "PATCH") ||
      (path === `/admin/qualification-levels/${owner.id}/rule-versions` && method === "POST"))
  )
    return { kind: "level", id: owner.id, game: owner.game };
  const input = body as Record<string, unknown>,
    promotion = path === `/admin/members/${owner.id}/promotions`;
  if (
    owner.kind === "member" &&
    method === "POST" &&
    (promotion || path === `/admin/members/${owner.id}/qualification-assignments`) &&
    input.game === owner.game
  ) {
    const levelId = promotion ? input.targetLevelId : input.levelId;
    if (typeof levelId !== "string") throw uncertain();
    return {
      kind: "member",
      id: owner.id,
      game: owner.game,
      levelId,
      roleChange: promotion && levelId === owner.rolePromotionLevelId,
    };
  }
  throw uncertain();
}
export function validateChangedResult(change: Change | null, name: keyof DTO, value: unknown) {
  if (!change) {
    if (name !== "EnvelopeQualificationPreview") throw uncertain();
    return undefined;
  }
  if (change.kind === "level") {
    const parsed = schema("EnvelopeQualificationLevel").safeParse(value),
      level = parsed.success ? parsed.data.data : undefined;
    if (
      name !== "EnvelopeQualificationLevel" ||
      !level ||
      level.id !== change.id ||
      level.game !== change.game
    )
      throw uncertain();
    return level;
  }
  if (change.kind === "ladder") {
    const parsed = schema("EnvelopeQualificationLadderRevision").safeParse(value);
    if (
      name !== "EnvelopeQualificationLadderRevision" ||
      !parsed.success ||
      parsed.data.data.game !== change.game
    )
      throw uncertain();
    return undefined;
  }
  const parsed = schema("EnvelopeAssignment").safeParse(value),
    assignment = parsed.success ? parsed.data.data : undefined;
  if (
    name !== "EnvelopeAssignment" ||
    !assignment ||
    assignment.game !== change.game ||
    assignment.levelId !== change.levelId ||
    assignment.id !== assignment.periodId
  )
    throw uncertain();
  return undefined;
}
export function affectedRead(
  change: Change,
  path: string,
  selfId: string | undefined,
  conflict = false,
) {
  const url = new URL(path, "https://qualification.invalid"),
    game = url.searchParams.get("game");
  if (url.pathname === `/admin/qualification-ladders/${change.game}`) return true;
  if (change.kind === "ladder")
    return (
      game === change.game &&
      (url.pathname === "/qualification-levels" ||
        (change.archive && url.pathname === "/admin/qualification-levels/archived") ||
        /\/qualification-(?:progress|assignments|action-history)$/.test(url.pathname))
    );
  if (change.kind === "level")
    return (
      (url.pathname === "/qualification-levels" && game === change.game) ||
      (url.pathname.endsWith("/qualification-progress") && game === change.game) ||
      isRuleHistory(change.id, path)
    );
  if (url.pathname === "/admin/qualification-members") return change.roleChange || conflict;
  const prefix = `/admin/members/${change.id}/`,
    own = change.id === selfId && url.pathname.startsWith("/me/");
  return (
    game === change.game &&
    (url.pathname.startsWith(prefix) || own) &&
    [
      "qualification-progress",
      "qualification-action-history",
      "qualification-assignments",
    ].includes(url.pathname.split("/").at(-1) ?? "")
  );
}
export function isRuleHistory(id: string, path: string) {
  const pathname = new URL(path, "https://qualification.invalid").pathname;
  return [
    `/qualification-levels/${id}/rule-versions`,
    `/admin/qualification-levels/${id}/rule-versions`,
  ].includes(pathname);
}

export function affectedQualificationProjection(change: Change, key: readonly unknown[]) {
  const path = String(key.at(-2) ?? "");
  if (key[0] === "administration") {
    if (path === "/admin/company-settings") return change.kind !== "member";
    if (path.startsWith("/admin/audit")) return true;
    if (path === "/admin/reinstatement-options") return change.kind !== "member";
    return (
      change.kind === "ladder" && change.archive && /^\/admin\/members(?:\?|\/[^/?]+$)/.test(path)
    );
  }
  if (key[0] === "driver-progress") {
    const target = change.kind === "member" ? `/members/${change.id}/` : "/members/";
    const progress = String(key.at(-1) ?? "");
    return (
      progress.startsWith(target) &&
      progress.endsWith(`/qualification-progress?game=${change.game}`)
    );
  }
  return key[0] === "driver-profile" && change.kind === "ladder" && change.archive;
}
