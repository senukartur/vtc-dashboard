import type { TruckersProfile } from "@vtc/db/external-identities-schema";

export const steamEndpoint = "https://steamcommunity.com/openid/login";
const namespace = "http://specs.openid.net/auth/2.0";
export const proofLifetimeMs = 600000;
export const nonceLifetimeMs = 300000;
export const providerDeadlineMs = 5000;
export const cacheLifetimeMs = 900000;
export type Failure = "transport" | "timeout" | "rate_limited" | "unavailable" | "invalid_response";
export class ProviderFailure extends Error {
  constructor(readonly category: Failure) {
    super("EXTERNAL_PROVIDER_FAILED");
  }
}
export type ProviderFetch = typeof fetch;
export function steamId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{16}$/.test(value))
    throw new ProviderFailure("invalid_response");
  return value;
}
export const steamProfile = (id: string) => `https://steamcommunity.com/profiles/${steamId(id)}`;
export function returnUrl(origin: string, id: string, state: string) {
  return `${origin}/api/v1/identity/steam/callback?verificationId=${id}&state=${state}`;
}
export function authorizationUrl(returnTo: string, origin: string) {
  const url = new URL(steamEndpoint);
  url.search = new URLSearchParams({
    "openid.ns": namespace,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": `${origin}/`,
    "openid.identity": `${namespace}/identifier_select`,
    "openid.claimed_id": `${namespace}/identifier_select`,
  }).toString();
  return url.toString();
}

// Own the entire receipt deadline, including a stalled response body. Never follow redirects.
async function boundedRequest(
  url: string,
  init: RequestInit,
  limit: number,
  transport: ProviderFetch,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = async () => {
    try {
      const response = await transport(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) throw new ProviderFailure("rate_limited");
      if (!response.ok) throw new ProviderFailure("unavailable");
      const size = response.headers.get("content-length");
      if (size && (!/^\d+$/.test(size) || Number(size) > limit))
        throw new ProviderFailure("invalid_response");
      if (!response.body) throw new ProviderFailure("invalid_response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          received += next.value.length;
          if (received > limit) throw new ProviderFailure("invalid_response");
          chunks.push(next.value);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        throw new ProviderFailure("invalid_response");
      }
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      throw new ProviderFailure(controller.signal.aborted ? "timeout" : "transport");
    }
  };
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderFailure("timeout"));
        }, providerDeadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function parseAssertion(raw: string) {
  if (Buffer.byteLength(raw) > 12288 || /%(?![a-fA-F0-9]{2})/.test(raw))
    throw new ProviderFailure("invalid_response");
  const query = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const allowed = [
    "verificationId",
    "state",
    "openid.ns",
    "openid.mode",
    "openid.op_endpoint",
    "openid.claimed_id",
    "openid.identity",
    "openid.return_to",
    "openid.response_nonce",
    "openid.assoc_handle",
    "openid.signed",
    "openid.sig",
    "openid.invalidate_handle",
  ];
  if ([...query].length > allowed.length) throw new ProviderFailure("invalid_response");
  for (const [key, value] of query) {
    if (
      !allowed.includes(key) ||
      query.getAll(key).length !== 1 ||
      value.length > 2048 ||
      [...value].some(
        (char) => char.charCodeAt(0) < 32 || [127, 65533].includes(char.charCodeAt(0)),
      )
    )
      throw new ProviderFailure("invalid_response");
  }
  return query;
}
export function steamProvider(transport: ProviderFetch = fetch) {
  return {
    async verify(query: URLSearchParams, expectedReturn: string, now: Date) {
      const get = (name: string) => query.get(`openid.${name}`) ?? "";
      const critical = [
        "op_endpoint",
        "claimed_id",
        "identity",
        "return_to",
        "response_nonce",
        "assoc_handle",
      ];
      const signed = get("signed").split(",");
      const claimed = /^https:\/\/steamcommunity\.com\/openid\/id\/([1-9][0-9]{16})$/.exec(
        get("claimed_id"),
      );
      const nonce = get("response_nonce");
      const prefix = nonce.slice(0, 20),
        stamp = Date.parse(prefix);
      if (
        get("ns") !== namespace ||
        get("mode") !== "id_res" ||
        get("op_endpoint") !== steamEndpoint ||
        get("return_to") !== expectedReturn ||
        !claimed ||
        get("identity") !== get("claimed_id") ||
        !critical.every((name) => signed.includes(name)) ||
        new Set(signed).size !== signed.length ||
        signed.some((name) => !/^[a-z_]+$/.test(name) || !query.has(`openid.${name}`)) ||
        !get("assoc_handle") ||
        !/^[A-Za-z0-9+/]{16,1024}={0,2}$/.test(get("sig")) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.{1,128}$/.test(nonce) ||
        !Number.isFinite(stamp) ||
        `${new Date(stamp).toISOString().slice(0, 19)}Z` !== prefix ||
        stamp > now.getTime() + 60000 ||
        stamp <= now.getTime() - nonceLifetimeMs
      )
        throw new ProviderFailure("invalid_response");
      const body = new URLSearchParams();
      for (const [key, value] of query) if (key.startsWith("openid.")) body.set(key, value);
      body.set("openid.mode", "check_authentication");
      const receipt = await boundedRequest(
        steamEndpoint,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        },
        4096,
        transport,
      );
      const fields = new Map<string, string>();
      for (const line of receipt.split("\n").filter(Boolean)) {
        const split = line.indexOf(":");
        const name = line.slice(0, split),
          value = line.slice(split + 1);
        if (
          split < 1 ||
          fields.has(name) ||
          !["ns", "is_valid", "invalidate_handle"].includes(name)
        )
          throw new ProviderFailure("invalid_response");
        fields.set(name, value);
      }
      if (fields.get("ns") !== namespace || fields.get("is_valid") !== "true")
        throw new ProviderFailure("invalid_response");
      return { steamId: steamId(claimed[1]), nonce };
    },
  };
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderFailure("invalid_response");
  return value as Record<string, unknown>;
};
const providerId = (value: unknown): string => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value)) return value;
  throw new ProviderFailure("invalid_response");
};
const label = (value: unknown, maximum: number, empty = false): string => {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!empty && !value.length) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new ProviderFailure("invalid_response");
  return value;
};
export function parseTruckers(
  value: unknown,
  requested: string,
): { found: boolean; profile: TruckersProfile | null } {
  const root = object(value);
  // The official player endpoint uses this explicit no-player result. Other errors are failures.
  if (
    root.error === true &&
    (root.descriptor === "Unable to find player with that ID." ||
      root.response === "Unable to find player with that ID.")
  )
    return { found: false, profile: null };
  if (root.error !== false) throw new ProviderFailure("invalid_response");
  const response = object(root.response),
    vtc = object(response.vtc);
  if (steamId(response.steamID) !== requested || typeof vtc.inVTC !== "boolean")
    throw new ProviderFailure("invalid_response");
  const profile: TruckersProfile = {
    playerId: providerId(response.id),
    displayName: label(response.name, 128),
    vtc: vtc.inVTC
      ? {
          inVtc: true,
          id: providerId(vtc.id),
          name: label(vtc.name, 128),
          tag: label(vtc.tag, 128, true),
          memberId: providerId(vtc.memberID),
        }
      : { inVtc: false, id: null, name: null, tag: null, memberId: null },
  };
  return { found: true, profile };
}
export function truckersProvider(transport: ProviderFetch = fetch) {
  return {
    async lookup(id: string) {
      const receipt = await boundedRequest(
        `https://api.truckersmp.com/v2/player/${steamId(id)}`,
        { method: "GET", headers: { accept: "application/json" } },
        65536,
        transport,
      );
      let value: unknown;
      try {
        value = JSON.parse(receipt);
      } catch {
        throw new ProviderFailure("invalid_response");
      }
      return parseTruckers(value, id);
    },
  };
}
export interface ExternalProviders {
  steam: ReturnType<typeof steamProvider>;
  truckers: ReturnType<typeof truckersProvider>;
}
