import { writeFile } from "node:fs/promises";

// No hostname, token, HTTP body, error text or target path enters the safe observation report.
try {
  const base = new URL(process.env.OPERATOR_BASE_URL);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !/^[a-f0-9]{64}$/.test(process.env.OPERATOR_TOKEN ?? "")
  )
    throw new Error("CONFIG_INVALID");
  const observations = [];
  const started = Date.now();
  let prior;
  for (let index = 0; index < 21; index++) {
    const due = started + index * 30000;
    await new Promise((accept) => setTimeout(accept, Math.max(0, due - Date.now())));
    const at = Date.now();
    let observation = { elapsedMs: at - started, available: false, durationMs: 0, fresh: false };
    try {
      const response = await fetch(new URL("/_operations/heartbeat", base), {
        headers: { Authorization: `Bearer ${process.env.OPERATOR_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      const value = await response.json();
      const timestamp = Date.parse(value.heartbeat?.atUtc);
      observation = {
        ...observation,
        available: response.ok && value.database === "available",
        durationMs: Date.now() - at,
        fresh: Number.isFinite(timestamp) && Date.now() - timestamp < 125000,
        ...(typeof value.heartbeat?.sequence === "string" && /^\d+$/.test(value.heartbeat.sequence)
          ? { advanced: prior === undefined || BigInt(value.heartbeat.sequence) > BigInt(prior) }
          : {}),
      };
      prior = value.heartbeat?.sequence;
    } catch {
      observation.durationMs = Date.now() - at;
    }
    observations.push(observation);
  }
  await writeFile(
    process.argv[2],
    `${JSON.stringify({ version: 1, intervalMs: 30000, observations }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Synthetic observation: completed");
} catch {
  console.error("Synthetic observation: failed");
  process.exitCode = 1;
}
