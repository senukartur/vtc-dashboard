import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool, type PoolConnection } from "mysql2/promise";
import type { DatabaseSettings } from "../index.js";
import { connectionOptions, discard, initializeSession } from "./session.js";

declare const contextBrand: unique symbol;
export type TxContext = { readonly [contextBrand]: true };
export type TransactionClient = Omit<MySql2Database, "transaction">;

export interface UnitOfWork {
  run<T>(command: (tx: TxContext) => Promise<T>): Promise<T>;
  client(tx: TxContext): TransactionClient;
  close(): Promise<void>;
}

export const transactionConnectionLimit = 5;
export const TRANSACTION_COMMIT_OUTCOME_UNKNOWN = "TRANSACTION_COMMIT_OUTCOME_UNKNOWN";

export class TransactionCommitOutcomeUnknownError extends Error {
  readonly code = TRANSACTION_COMMIT_OUTCOME_UNKNOWN;

  constructor(cause: unknown) {
    super(TRANSACTION_COMMIT_OUTCOME_UNKNOWN, { cause });
    this.name = "TransactionCommitOutcomeUnknownError";
  }
}

async function controlQuery(connection: PoolConnection, sql: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // mysql2 starts its query timer only when the command reaches the wire. Bound the
    // wall clock too: cleanup may be queued behind a command that never completed.
    await Promise.race([
      connection.query({ sql, timeout: 1000 }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("TRANSACTION_CONTROL_TIMEOUT")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createUnitOfWork(settings: DatabaseSettings): UnitOfWork {
  const pool = createPool({
    ...connectionOptions(settings),
    connectionLimit: transactionConnectionLimit,
    waitForConnections: false,
  });
  const contexts = new WeakMap<TxContext, { active: boolean; client: TransactionClient }>();
  return {
    client(tx) {
      const state = contexts.get(tx);
      if (!state?.active) throw new Error("INACTIVE_OR_FOREIGN_TRANSACTION");
      return state.client;
    },
    async run<T>(command: (tx: TxContext) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      let reusable = false;
      const tx = Object.freeze({}) as TxContext;
      try {
        await initializeSession(connection);
        await controlQuery(connection, "START TRANSACTION");
        const assertActive = () => {
          if (!contexts.get(tx)?.active) throw new Error("INACTIVE_OR_FOREIGN_TRANSACTION");
        };
        const guardedConnection = new Proxy(connection, {
          get(target, key) {
            if (key === "connection") throw new Error("TRANSACTION_STREAMING_UNSUPPORTED");
            const value: unknown = Reflect.get(target, key);
            if (key === "query" || key === "execute") {
              return (...args: unknown[]) => {
                assertActive();
                return Reflect.apply(value as (...args: unknown[]) => unknown, target, args);
              };
            }
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const client = new Proxy(drizzle(guardedConnection), {
          get(target, key, receiver) {
            if (key === "transaction" || key === "$client")
              throw new Error("NESTED_TRANSACTION_UNSUPPORTED");
            return Reflect.get(target, key, receiver);
          },
        });
        contexts.set(tx, { active: true, client });
        let result: T;
        try {
          result = await command(tx);
        } catch (error) {
          const state = contexts.get(tx);
          if (state) state.active = false;
          try {
            await controlQuery(connection, "ROLLBACK");
          } catch {
            // Preserve the command failure; finally discards even a queued/stalled rollback.
          }
          throw error;
        }
        const state = contexts.get(tx);
        if (state) state.active = false;
        // A lost COMMIT response is uncertain. Never queue rollback behind that command;
        // the outer finally immediately discards its connection on any commit failure.
        try {
          await controlQuery(connection, "COMMIT");
        } catch (cause) {
          throw new TransactionCommitOutcomeUnknownError(cause);
        }
        reusable = true;
        return result;
      } finally {
        contexts.delete(tx);
        if (reusable) connection.release();
        else discard(connection);
      }
    },
    close: () => pool.end(),
  };
}
