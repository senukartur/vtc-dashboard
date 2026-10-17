// A build from a development container must still compile React in production mode.
process.env.NODE_ENV = "production";
const { build } = await import("vite");
await build({ mode: "production" });
