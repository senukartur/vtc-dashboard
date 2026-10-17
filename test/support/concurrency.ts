import { setTimeout as delay } from "node:timers/promises";
import { type DatabaseSettings, dedicatedConnection } from "@vtc/db";
import type { Connection } from "mysql2/promise";

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function bounded<T>(work: Promise<T>, label: string, timeout = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TEST_DEADLINE_${label}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function barrier(participants: number) {
  if (!Number.isSafeInteger(participants) || participants < 1)
    throw new Error("INVALID_BARRIER_SIZE");
  let arrived = 0;
  const gate = deferred<void>();
  return async () => {
    if (++arrived > participants) throw new Error("BARRIER_ALREADY_USED");
    if (arrived === participants) gate.resolve();
    await bounded(gate.promise, "barrier");
  };
}

export async function until(condition: () => Promise<boolean>, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await bounded(condition(), "condition", Math.max(1, deadline - Date.now())))) {
    if (Date.now() >= deadline) throw new Error("TEST_CONDITION_TIMEOUT");
    await delay(10);
  }
}

export async function connections<T>(
  settings: DatabaseSettings,
  count: number,
  work: (clients: Connection[]) => Promise<T>,
): Promise<T> {
  const clients: Connection[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const client = await dedicatedConnection(settings);
      clients.push(client);
      await client.query("SET SESSION innodb_lock_wait_timeout = 2");
    }
    return await bounded(work(clients), "connections", 10000);
  } finally {
    // Destroy on teardown, including pending lock requests. A timeout alone does not cancel SQL.
    for (const client of clients) {
      client.destroy();
      (
        client as unknown as { connection: { stream: { destroy(): void } } }
      ).connection.stream.destroy();
    }
  }
}

export async function transaction<T>(
  client: Connection,
  work: (attempt: number) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
    throw new Error("INVALID_TEST_RETRY_BOUND");
  for (let attempt = 1; ; attempt++) {
    await client.beginTransaction();
    let value: T;
    try {
      value = await work(attempt);
    } catch (error) {
      await client.rollback();
      if (
        attempt < maxAttempts &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ER_LOCK_DEADLOCK"
      )
        continue;
      throw error;
    }
    // Outside retry catch: an uncertain COMMIT must never repeat the callback.
    await client.commit();
    return value;
  }
}
