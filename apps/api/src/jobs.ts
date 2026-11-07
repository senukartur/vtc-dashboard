import { ownedCli } from "./platform/jobs/process.js";

// The supervisor only spawns and bounds the worker. Loading the application graph here as well
// would double the start-up cost of every pass, so only the worker imports it.
await ownedCli(async () => (await import("./jobs-worker.js")).runJobsWorker());
