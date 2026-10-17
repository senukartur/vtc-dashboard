export type { components, operations, paths } from "./generated/browser.js";

export interface Readiness {
  status: "ready" | "not_ready";
}

export const readinessSchema = {
  type: "object",
  properties: { status: { type: "string", enum: ["ready", "not_ready"] } },
  required: ["status"],
  additionalProperties: false,
} as const;
