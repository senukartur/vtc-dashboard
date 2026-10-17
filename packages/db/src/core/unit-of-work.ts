import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";
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
    async run(command) {
      const connection = await pool.getConnection();
      let reusable = false;
      const tx = Object.freeze({}) as TxContext;
      try {
        await initializeSession(connection);
        await connection.query({ sql: "START TRANSACTION", timeout: 1000 });
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
        try {
          const result = await command(tx);
          const state = contexts.get(tx);
          if (state) state.active = false;
          await connection.query({ sql: "COMMIT", timeout: 1000 });
          reusable = true;
          return result;
        } catch (error) {
          const state = contexts.get(tx);
          if (state) state.active = false;
          await connection.query({ sql: "ROLLBACK", timeout: 1000 });
          // Destroy on every failure, including driver query timeouts and broken streams.
          throw error;
        }
      } finally {
        contexts.delete(tx);
        if (reusable) connection.release();
        else discard(connection);
      }
    },
    close: () => pool.end(),
  };
}
