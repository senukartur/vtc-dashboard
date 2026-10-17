import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type DatabaseSettings, settingsFromEnvironment } from "@vtc/db";

export interface Allocation {
  run: string;
  lane: string;
  token: string;
  ownerConnectionId: number;
  settings: DatabaseSettings;
}

export function guardedAllocation(): Allocation {
  const path = process.env.VTC_TEST_CONFIG;
  const output = resolve(".local/testing");
  if (
    !path ||
    !isAbsolute(path) ||
    isAbsolute(relative(output, path)) ||
    relative(output, path).startsWith("..")
  )
    throw new Error("LAUNCHER_ALLOCATION_REQUIRED");
  const value = JSON.parse(readFileSync(path, "utf8")) as Allocation;
  const current = settingsFromEnvironment();
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.DB_TEST_RESET_ACK !== "synthetic-only" ||
    !/^[a-f0-9]{16}$/.test(value.run) ||
    !/^[a-f0-9]{32}$/.test(value.token) ||
    !Number.isSafeInteger(value.ownerConnectionId) ||
    value.ownerConnectionId < 1 ||
    !/^[a-z0-9]+$/.test(value.lane) ||
    value.settings.database !== `vtc_test_${value.run}_${value.lane}` ||
    !["db", "127.0.0.1", "localhost"].includes(current.host) ||
    Object.keys(current).some(
      (key) =>
        current[key as keyof DatabaseSettings] !== value.settings[key as keyof DatabaseSettings],
    )
  ) {
    throw new Error("LAUNCHER_ALLOCATION_MISMATCH");
  }
  return value;
}

export function safeChildEnvironment(): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "PLAYWRIGHT_BROWSERS_PATH",
  ];
  return {
    ...Object.fromEntries(
      keep.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
    ),
    NODE_ENV: "test",
    TZ: "UTC",
    NO_COLOR: "1",
  };
}

export function assertLocalOrigin(input: string): void {
  const url = new URL(input);
  if (url.origin !== "http://127.0.0.1:4173" || url.username || url.password)
    throw new Error("EXTERNAL_TEST_REQUEST_BLOCKED");
}
