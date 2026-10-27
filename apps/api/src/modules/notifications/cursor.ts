import { createHmac, timingSafeEqual } from "node:crypto";
import { signedBigint } from "@vtc/db";
import { closed } from "../../platform/outbox/events.js";
import { type Actor, identityError } from "../identity/service.js";
export type CursorRoute = "poll" | "history" | "read-through";
// A returned poll checkpoint carries distinct poll/read-through proofs for the same committed
// boundary. History has neither authority. No extra browser field or new sequence is exposed.
export function notificationCursors(key: string) {
  const mac = (route: CursorRoute, body: string) =>
    createHmac("sha256", Buffer.from(key, "hex"))
      .update("notifications/cursor/v1\0")
      .update(`${route}\0`)
      .update(body)
      .digest();
  const binding = (a: Actor, route: Exclude<CursorRoute, "read-through">) =>
    JSON.stringify([
      a.userId,
      a.sessionId,
      a.accessEpoch,
      a.credentialEpoch,
      route,
      route === "poll" ? "ascending" : "descending",
      [],
    ]);
  return {
    encode(a: Actor, route: Exclude<CursorRoute, "read-through">, sequence: string) {
      signedBigint(sequence);
      const body = Buffer.from(JSON.stringify({ binding: binding(a, route), sequence })).toString(
        "base64url",
      );
      return `${body}.${mac(route, body).toString("base64url")}${route === "poll" ? `.${mac("read-through", body).toString("base64url")}` : ""}`;
    },
    decode(a: Actor, route: CursorRoute, cursor: string) {
      try {
        if (typeof cursor !== "string" || cursor.length > 2048) throw new Error();
        const parts = cursor.split(".");
        if (parts.length !== (route === "history" ? 2 : 3)) throw new Error();
        const body = parts[0] ?? "",
          signature = parts[route === "read-through" ? 2 : 1] ?? "";
        const supplied = Buffer.from(signature, "base64url"),
          expected = mac(route, body);
        if (
          Buffer.from(body, "base64url").toString("base64url") !== body ||
          supplied.toString("base64url") !== signature ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw new Error();
        if (route !== "history") {
          const alternate = route === "poll" ? "read-through" : "poll",
            proof = parts[route === "poll" ? 2 : 1] ?? "",
            bytes = Buffer.from(proof, "base64url"),
            expected = mac(alternate, body);
          if (
            bytes.toString("base64url") !== proof ||
            bytes.length !== expected.length ||
            !timingSafeEqual(bytes, expected)
          )
            throw new Error();
        }
        const value = closed(JSON.parse(Buffer.from(body, "base64url").toString()), [
          "binding",
          "sequence",
        ]);
        if (
          value.binding !== binding(a, route === "read-through" ? "poll" : route) ||
          typeof value.sequence !== "string" ||
          BigInt(signedBigint(value.sequence)) < 0n
        )
          throw new Error();
        return value.sequence;
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    },
  };
}
