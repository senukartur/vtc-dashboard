import { createConnection, createServer, type AddressInfo, type Socket } from "node:net";
import { deferred } from "../support/concurrency.ts";
import { guardedSettings } from "./support.ts";

// Transparent plaintext transport for this guarded synthetic allocation only. All result
// bytes come from real MySQL; one real journal OK packet is withheld, never synthesized.
export async function journalAckGate(target: "insert" | "finalize", positiveFinalization?: number) {
  if (
    positiveFinalization !== undefined &&
    (target !== "finalize" ||
      !Number.isSafeInteger(positiveFinalization) ||
      positiveFinalization < 1)
  )
    throw new Error("INVALID_SYNTHETIC_FINALIZATION_GATE");
  const settings = guardedSettings();
  const withheld = deferred<void>();
  const waiterForwarded = deferred<void>();
  const positive = positiveFinalization !== undefined;
  let held: { client: Socket; packet: Buffer; resume: () => void } | undefined;
  let released = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  const clients = new Set<Socket>();
  const upstreams = new Set<Socket>();
  const facts = {
    inserts: 0,
    finalizations: 0,
    statements: 0,
    releases: 0,
    okPackets: 0,
    ends: 0,
    queryAttributeEnvelopes: 0,
    unsupportedEnvelopes: 0,
    waiterRequests: 0,
    waiterResponses: 0,
    waiterResponseBeforeRelease: false,
    explicitReleases: 0,
    automaticRelease: false,
  };
  function release(automatic = false) {
    if (!positive || !held || released) return;
    released = true;
    clearTimeout(releaseTimer);
    if (automatic) facts.automaticRelease = true;
    else facts.explicitReleases++;
    held.resume();
    held.client.write(held.packet);
    held = undefined;
  }
  function packets(receive: (packet: Buffer) => void) {
    let buffered: Buffer = Buffer.alloc(0);
    return (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readUIntLE(0, 3) + 4;
        if (buffered.length < length) break;
        const packet = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        receive(packet);
      }
    };
  }
  const server = createServer({ allowHalfOpen: true }, (client) => {
    clients.add(client);
    const upstream = createConnection({ host: settings.host, port: settings.port });
    upstreams.add(upstream);
    let hold = false;
    let captured = false;
    let clientHandshake = true;
    let authenticated = false;
    let serverAttributes = false;
    let clientAttributes = false;
    let waitingForLockResponse = false;
    const unsupported = () => {
      facts.unsupportedEnvelopes++;
      withheld.reject(new Error("UNSUPPORTED_SYNTHETIC_MYSQL_ENVELOPE"));
      client.destroy();
      upstream.destroy();
    };
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.once("end", () => {
      facts.ends++;
      upstream.end();
    });
    upstream.once("end", () => client.end());
    client.once("close", () => {
      clients.delete(client);
      upstream.destroy();
    });
    upstream.once("close", () => {
      upstreams.delete(upstream);
      client.destroy();
    });
    client.on(
      "data",
      packets((packet) => {
        if (clientHandshake) {
          clientHandshake = false;
          // This test transport supports plaintext, uncompressed protocol 4.1 only.
          if (packet.length < 36 || (packet.readUInt32LE(4) & (0x0800 | 0x0020)) !== 0) {
            unsupported();
            return;
          }
          clientAttributes = (packet.readUInt32LE(4) & 0x08000000) !== 0;
        } else if (authenticated && packet[4] === 3) {
          const attributes = serverAttributes && clientAttributes;
          // Pinned mysql2 emits zero attributes + one parameter set before SQL when negotiated.
          // Do not silently interpret attributed queries or other envelopes as ordinary SQL.
          if (attributes && (packet[5] !== 0 || packet[6] !== 1)) {
            unsupported();
            return;
          }
          if (attributes) facts.queryAttributeEnvelopes++;
          const query = packet.subarray(attributes ? 7 : 5).toString("utf8");
          const insert = query.startsWith("INSERT INTO _vtc_migrations");
          const finalize = query.startsWith("UPDATE _vtc_migrations");
          if (insert) facts.inserts++;
          if (finalize) facts.finalizations++;
          if (query.startsWith("CREATE TABLE synthetic_parent")) facts.statements++;
          if (query.startsWith("SELECT RELEASE_LOCK")) facts.releases++;
          if (
            (target === "insert" && insert) ||
            (target === "finalize" &&
              finalize &&
              (!positive || facts.finalizations === positiveFinalization))
          )
            hold = true;
          if (positive && held && query.startsWith("SELECT GET_LOCK(")) {
            facts.waiterRequests++;
            waitingForLockResponse = true;
            upstream.write(packet, () => waiterForwarded.resolve());
            return;
          }
        }
        upstream.write(packet);
      }),
    );
    upstream.on(
      "data",
      packets((packet) => {
        if (!authenticated && packet[4] === 10) {
          const versionEnd = packet.indexOf(0, 5);
          const lower = versionEnd + 14,
            upper = lower + 5;
          if (versionEnd < 5 || packet.length < upper + 2) {
            unsupported();
            return;
          }
          const capabilities = packet.readUInt16LE(lower) | (packet.readUInt16LE(upper) << 16);
          serverAttributes = (capabilities & 0x08000000) !== 0;
        } else if (!authenticated && packet[4] === 0) authenticated = true;
        if (hold) {
          if (!captured) {
            captured = true;
            if (packet[4] === 0) facts.okPackets++;
            if (positive) {
              if (packet[4] !== 0) {
                unsupported();
                return;
              }
              // Retain and later forward the genuine MySQL ACK exactly once. A short
              // safety release prevents test coordination consuming the five-second receipt cap.
              held = {
                client,
                packet: Buffer.from(packet),
                resume: () => {
                  hold = false;
                },
              };
              releaseTimer = setTimeout(() => release(true), 2000);
            }
            withheld.resolve();
          }
          return;
        }
        if (waitingForLockResponse) {
          waitingForLockResponse = false;
          facts.waiterResponses++;
          if (!released) facts.waiterResponseBeforeRelease = true;
        }
        client.write(packet);
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    settings: { ...settings, host: "127.0.0.1", port: (server.address() as AddressInfo).port },
    withheld: withheld.promise,
    waiterForwarded: waiterForwarded.promise,
    release: () => release(),
    facts,
    activeSockets: () => clients.size + upstreams.size,
    async close() {
      clearTimeout(releaseTimer);
      for (const socket of [...clients, ...upstreams]) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
