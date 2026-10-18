import { type Connection, createConnection, type PoolConnection } from "mysql2/promise";
import { type DatabaseSettings, requiredSqlModes } from "../index.js";
import { observeDatabaseOperation } from "./operation-context.js";

export function connectionOptions(settings: DatabaseSettings) {
  return {
    ...settings,
    connectTimeout: 1000,
    timezone: "Z",
    charset: "utf8mb4_0900_ai_ci",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
  } as const;
}

export function discard(connection: Connection | PoolConnection): void {
  // Recheck this pinned-driver adapter on mysql2 upgrades; see readiness regression.
  const driver = (connection as unknown as { connection: { stream: { destroy(): void } } })
    .connection;
  connection.destroy();
  driver.stream.destroy();
}

export async function initializeSession(connection: Connection): Promise<void> {
  await observeDatabaseOperation("session_configuration", 1000, () =>
    connection.query({
      sql: "SET SESSION time_zone = '+00:00', sql_mode = ?, transaction_isolation = 'REPEATABLE-READ', autocommit = 1",
      values: [requiredSqlModes.join(",")],
      timeout: 1000,
    }),
  );
  await observeDatabaseOperation("session_charset", 1000, () =>
    connection.query({ sql: "SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci", timeout: 1000 }),
  );
}

export async function dedicatedConnection(settings: DatabaseSettings): Promise<Connection> {
  const connection = await observeDatabaseOperation("connection_open", 1000, () =>
    createConnection(connectionOptions(settings)),
  );
  try {
    await initializeSession(connection);
    return connection;
  } catch (error) {
    discard(connection);
    throw error;
  }
}

export function settingsFromEnvironment(): DatabaseSettings {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error("DATABASE_CONFIGURATION_MISSING");
    return value;
  };
  const port = Number(required("MYSQL_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DATABASE_PORT_INVALID");
  return {
    host: required("MYSQL_HOST"),
    port,
    database: required("MYSQL_DATABASE"),
    user: required("MYSQL_USER"),
    password: required("MYSQL_PASSWORD"),
  };
}
