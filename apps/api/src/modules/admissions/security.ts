import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { applicationId } from "@vtc/db";
import { identityError } from "../identity/service.js";
import { mailbox } from "../messaging/content.js";

export interface AdmissionsConfig {
  key: string;
  origin: string;
}
export interface ApplicationInput {
  nickname: string;
  email: string;
  steamProfileUrl: string;
  games: ("ets2" | "ats")[];
  discord?: string | null;
  introduction?: string | null;
}
const canonical = (input: unknown): string =>
  JSON.stringify(input, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
export function admissionsSecurity(config: AdmissionsConfig) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.key)) throw new Error("INVALID_ADMISSIONS_KEY");
  const key = Buffer.from(config.key, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== config.key)
    throw new Error("INVALID_ADMISSIONS_KEY");
  const origin = new URL(config.origin);
  if (
    origin.origin !== config.origin ||
    origin.username ||
    origin.password ||
    !["https:", "http:"].includes(origin.protocol)
  )
    throw new Error("INVALID_ADMISSIONS_ORIGIN");
  const digest = (scope: string, input: unknown): Buffer =>
    createHmac("sha256", key)
      .update(`vtc:admissions:v1:${scope}:${canonical(input)}`)
      .digest();
  const sign = (value: string) => digest("cursor", value).toString("base64url");
  return {
    digest,
    token: () => randomBytes(32).toString("base64url"),
    seal(id: string, application: string, token: string): string {
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(
        Buffer.from(
          `vtc:admissions:invitation:v1:${config.origin}:${applicationId(application)}:${applicationId(id)}`,
        ),
      );
      return Buffer.concat([
        iv,
        cipher.update(token, "utf8"),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64url");
    },
    open(id: string, application: string, value: string): string {
      const bytes = Buffer.from(value, "base64url"),
        cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAAD(
        Buffer.from(
          `vtc:admissions:invitation:v1:${config.origin}:${applicationId(application)}:${applicationId(id)}`,
        ),
      );
      cipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(
        "utf8",
      );
    },
    cursor(binding: string, at: string, id: string) {
      const value = Buffer.from(
        JSON.stringify({
          binding: digest("cursor-binding", binding).toString("base64url"),
          at,
          id,
        }),
      ).toString("base64url");
      return `${value}.${sign(value)}`;
    },
    readCursor(binding: string, value: string): { at: string; id: string } {
      try {
        if (value.length > 2048) throw new Error();
        const [payload, signature, extra] = value.split(".");
        if (!payload || !signature || extra || !equal(sign(payload), signature)) throw new Error();
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
          binding: string;
          at: string;
          id: string;
        };
        if (
          decoded.binding !== digest("cursor-binding", binding).toString("base64url") ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(decoded.at) ||
          !Number.isFinite(Date.parse(decoded.at))
        )
          throw new Error();
        return { at: decoded.at, id: applicationId(decoded.id) };
      } catch {
        throw identityError(422);
      }
    },
    link(token: string) {
      return `${config.origin}/invitation?token=${encodeURIComponent(token)}`;
    },
  };
}
export function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function bounded(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    ![...value].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    }) &&
    Buffer.from(value).toString("utf8") === value
  );
}
export function validateApplication(input: ApplicationInput) {
  try {
    if (
      !input ||
      Object.keys(input).some(
        (key) =>
          !["nickname", "email", "steamProfileUrl", "games", "discord", "introduction"].includes(
            key,
          ),
      ) ||
      !bounded(input.nickname, 128) ||
      !Array.isArray(input.games) ||
      !input.games.length ||
      input.games.length > 2 ||
      new Set(input.games).size !== input.games.length ||
      input.games.some((g) => !["ets2", "ats"].includes(g))
    )
      throw new Error();
    mailbox(input.email);
    const url = new URL(input.steamProfileUrl);
    if (
      input.steamProfileUrl.length > 512 ||
      !/^https:\/\/steamcommunity\.com\/(?:profiles\/[0-9]{17}|id\/[A-Za-z0-9_-]+)\/?$/.test(
        input.steamProfileUrl,
      ) ||
      url.protocol !== "https:" ||
      url.hostname !== "steamcommunity.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/(?:profiles\/[0-9]{17}|id\/[A-Za-z0-9_-]+)\/?$/.test(url.pathname)
    )
      throw new Error();
    if (
      (input.discord != null && !bounded(input.discord, 256)) ||
      (input.introduction != null && !bounded(input.introduction, 4000))
    )
      throw new Error();
    return {
      ...input,
      games: [...input.games].sort(),
      discord: input.discord ?? null,
      introduction: input.introduction ?? null,
    };
  } catch {
    throw identityError(422);
  }
}
export function rejectionReason(value: unknown): string {
  if (!bounded(value, 2048)) throw identityError(422);
  return value;
}
