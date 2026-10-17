import { afterEach, beforeEach, vi } from "vitest";

// Network isolation is provided by Docker. This also catches accidental fetch use early.
beforeEach(() =>
  vi.stubGlobal("fetch", () => Promise.reject(new Error("UNEXPECTED_TEST_NETWORK_REQUEST"))),
);
afterEach(() => {
  vi.useRealTimers();
});
