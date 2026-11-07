import { ownedCli } from "./platform/jobs/process.js";

// Same split as jobs.ts: the supervisor stays light and only the worker loads the application.
await ownedCli(async () => (await import("./jobs-acceptance-worker.js")).runAcceptanceWorker());
