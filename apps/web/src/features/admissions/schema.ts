import type { components } from "@vtc/contracts";
import { browserSchemaDocument } from "@vtc/contracts/runtime";
import { z } from "zod";

export type ApplicationInput = components["schemas"]["ApplicationInput"];
export type ApplicationFields = {
  nickname: string;
  email: string;
  steamProfileUrl: string;
  games: ("ets2" | "ats")[];
  discord: string;
  introduction: string;
};
// Read bounds and patterns from the generated contract; server semantic validation is authoritative.
const definitions = browserSchemaDocument.$defs as Record<
  string,
  {
    properties: Record<
      string,
      {
        minLength?: number;
        maxLength?: number;
        minimum?: number;
        maximum?: number;
        pattern?: string;
      }
    >;
  }
>;
const input = definitions.ApplicationInput?.properties;
const max = (field: string) => input?.[field]?.maxLength ?? 0;
const text = (limit: number) =>
  z
    .string()
    .max(limit)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(value) &&
        ![...value].some((char) => {
          const code = char.codePointAt(0) ?? 0;
          return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
        }),
    );
const optional = (limit: number) =>
  z.string().refine((value) => !value.trim() || text(limit).safeParse(value).success);
export const applicationSchema = z.strictObject({
  nickname: text(max("nickname")),
  email: z
    .string()
    .max(max("email"))
    .regex(
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/,
    ),
  steamProfileUrl: z
    .string()
    .max(max("steamProfileUrl"))
    .regex(new RegExp(input?.steamProfileUrl?.pattern ?? "(?!)")),
  games: z
    .array(z.enum(["ets2", "ats"]))
    .min(1)
    .max(2)
    .refine((value) => new Set(value).size === value.length),
  discord: optional(256),
  introduction: optional(4000),
});
export function applicationPayload(fields: ApplicationFields): ApplicationInput {
  return {
    nickname: fields.nickname,
    email: fields.email,
    steamProfileUrl: fields.steamProfileUrl,
    games: [...fields.games].sort(),
    ...(fields.discord.trim() ? { discord: fields.discord } : {}),
    ...(fields.introduction.trim() ? { introduction: fields.introduction } : {}),
  };
}
const meta = z.strictObject({
  requestId: z
    .string()
    .min(definitions.Meta?.properties.requestId?.minLength ?? 1)
    .max(definitions.Meta?.properties.requestId?.maxLength ?? 128),
});
export const csrfEnvelope = z.strictObject({
  data: z.strictObject({
    token: z
      .string()
      .min(definitions.Csrf?.properties.token?.minLength ?? 1)
      .max(definitions.Csrf?.properties.token?.maxLength ?? 512),
  }),
  meta,
});
export const receiptEnvelope = z.strictObject({
  data: z.strictObject({
    id: z.string().regex(new RegExp(definitions.CommandResult?.properties.id?.pattern ?? "(?!)")),
    version: z
      .number()
      .int()
      .min(definitions.CommandResult?.properties.version?.minimum ?? 1)
      .max(definitions.CommandResult?.properties.version?.maximum ?? Number.MAX_SAFE_INTEGER),
  }),
  meta,
});
