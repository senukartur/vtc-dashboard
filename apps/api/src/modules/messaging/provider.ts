import type { MailRequest } from "./content.js";
import { createHash } from "node:crypto";

export const categories = [
  "rate_limit",
  "daily_quota",
  "monthly_quota",
  "authentication",
  "validation",
  "idempotency_conflict",
  "concurrent_request",
  "provider_unavailable",
  "acceptance_unknown",
  "payload_unavailable",
  "obsolete",
  "idempotency_expired",
  "attempts_exhausted",
  "provider_changed",
  "worker_configuration",
  "not_started",
] as const;
export type Category = (typeof categories)[number];
export type Outcome =
  | { state: "accepted"; receipt: string }
  | { state: "simulated"; receipt: string }
  | { state: "rejected"; category: Category; retryAfterMs: number | null }
  | { state: "ambiguous"; category: "acceptance_unknown" };
export interface MailProvider {
  mode: "local" | "resend";
  scope: string;
  send(request: MailRequest, key: string, signal: AbortSignal): Promise<Outcome>;
}
export function classify(status: number, name: unknown, now = Date.now()): Outcome {
  const rejected = (category: Category, retryAfterMs: number | null): Outcome => ({
    state: "rejected",
    category,
    retryAfterMs,
  });
  if (status === 429) {
    if (name === "daily_quota_exceeded")
      return rejected(
        "daily_quota",
        Math.max(60000, (Math.floor(now / 86400000) + 1) * 86400000 - now),
      );
    if (name === "monthly_quota_exceeded") return rejected("monthly_quota", null);
    return rejected("rate_limit", 60000);
  }
  if (status === 409)
    return name === "concurrent_idempotent_requests"
      ? rejected("concurrent_request", 60000)
      : rejected("idempotency_conflict", null);
  if ([401, 403].includes(status)) return rejected("authentication", null);
  if ([400, 404, 405, 413, 422].includes(status)) return rejected("validation", null);
  // A server error may follow provider acceptance. Repetition is safe only inside
  // the stored idempotency window; transport/invalid responses stay ambiguous.
  if ([500, 502, 503, 504].includes(status)) return rejected("provider_unavailable", 60000);
  return { state: "ambiguous", category: "acceptance_unknown" };
}
export function localProvider(): MailProvider {
  return {
    mode: "local",
    scope: "local-v1",
    async send(_request, key, signal) {
      if (signal.aborted) return { state: "ambiguous", category: "acceptance_unknown" };
      return { state: "simulated", receipt: `local:${key}` };
    },
  };
}
export function resendProvider(apiKey: string, transport: typeof fetch = fetch): MailProvider {
  if (!apiKey || apiKey.length > 512 || /\s/.test(apiKey) || apiKey.startsWith("REPLACE_"))
    throw new Error("INVALID_MAIL_PROVIDER_KEY");
  return {
    mode: "resend",
    scope: createHash("sha256").update(apiKey).digest("hex"),
    async send(request, key, signal) {
      try {
        const response = await transport("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(request),
        });
        // Bound response consumption even when content-length is absent/untruthful.
        const reader = response.body?.getReader();
        if (!reader) return { state: "ambiguous", category: "acceptance_unknown" };
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 8192) {
              await reader.cancel();
              return { state: "ambiguous", category: "acceptance_unknown" };
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body))
          return { state: "ambiguous", category: "acceptance_unknown" };
        if (response.ok) {
          const id = "id" in body ? body.id : undefined;
          return typeof id === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id)
            ? { state: "accepted", receipt: id }
            : { state: "ambiguous", category: "acceptance_unknown" };
        }
        return classify(response.status, "name" in body ? body.name : undefined);
      } catch {
        return { state: "ambiguous", category: "acceptance_unknown" };
      }
    },
  };
}
