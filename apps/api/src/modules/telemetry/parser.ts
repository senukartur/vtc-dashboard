import { type Telemetry, telemetryAdapter } from "../sources/contracts/telemetry.js";

export class TelemetryError extends Error {
  constructor(
    readonly statusCode: number,
    readonly publicCode: string,
    readonly retryAfter?: number,
  ) {
    super("TELEMETRY_REQUEST_FAILED");
  }
}
export const fail = (status: number, code: string): never => {
  throw new TelemetryError(status, code);
};
// Parse the original bytes before JSON.parse can discard duplicate keys or round integers.
export function parseJson(bytes: Buffer): unknown {
  if (bytes.length > 65536) return fail(413, "PAYLOAD_TOO_LARGE");
  try {
    const input = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    let i = 0;
    const ws = () => {
      while ([" ", "\t", "\n", "\r"].includes(input[i] ?? "x")) i++;
    };
    function string(): string {
      const start = i++;
      while (i < input.length) {
        const c = input[i++];
        if (c === '"') return JSON.parse(input.slice(start, i)) as string;
        if (c === "\\") i++;
      }
      throw new Error();
    }
    function value(depth: number): unknown {
      ws();
      if (depth > 16) throw new Error();
      if (input[i] === '"') return string();
      if (input[i] === "{") {
        i++;
        ws();
        const keys = new Set<string>();
        const result: Record<string, unknown> = Object.create(null);
        if (input[i] === "}") {
          i++;
          return result;
        }
        while (true) {
          ws();
          if (input[i] !== '"') throw new Error();
          const key = string();
          if (keys.has(key)) throw new Error();
          keys.add(key);
          ws();
          if (input[i++] !== ":") throw new Error();
          result[key] = value(depth + 1);
          ws();
          const end = input[i++];
          if (end === "}") return result;
          if (end !== ",") throw new Error();
        }
      }
      if (input[i] === "[") {
        i++;
        ws();
        const result: unknown[] = [];
        if (input[i] === "]") {
          i++;
          return result;
        }
        while (true) {
          result.push(value(depth + 1));
          ws();
          const end = input[i++];
          if (end === "]") return result;
          if (end !== ",") throw new Error();
        }
      }
      for (const [literal, result] of [
        ["true", true],
        ["false", false],
        ["null", null],
      ] as const)
        if (input.startsWith(literal, i)) {
          i += literal.length;
          return result;
        }
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!match) throw new Error();
      i += match[0].length;
      const number = Number(match[0]);
      if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error();
      return number;
    }
    const result = value(0);
    ws();
    if (i !== input.length) throw new Error();
    return result;
  } catch {
    return fail(400, "INVALID_PAYLOAD");
  }
}
export function contract(value: unknown) {
  const version = value && typeof value === "object" && "contract" in value ? value.contract : null;
  if (!version || typeof version !== "object" || !("major" in version) || !("minor" in version))
    return fail(400, "INVALID_PAYLOAD");
  if (version.major !== 1 || version.minor !== 0) return fail(422, "UNSUPPORTED_CONTRACT");
}
export function event(value: unknown): Telemetry {
  contract(value);
  try {
    telemetryAdapter.identity(value);
    return value as Telemetry;
  } catch {
    return fail(400, "INVALID_PAYLOAD");
  }
}
