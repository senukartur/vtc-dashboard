import {
  createPool,
  type PoolConnection,
  type PoolOptions,
  type RowDataPacket,
} from "mysql2/promise";

export { type AuditInput, createAudit } from "./core/audit.js";
export { migrationFolder, migrationLockName, runMigrations } from "./core/migrations.js";
export { dedicatedConnection, settingsFromEnvironment } from "./core/session.js";
export {
  createUnitOfWork,
  TRANSACTION_COMMIT_OUTCOME_UNKNOWN,
  type TransactionClient,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  transactionConnectionLimit,
  type UnitOfWork,
} from "./core/unit-of-work.js";
export {
  applicationId,
  bigintColumn,
  decimal38_18,
  decimalColumn,
  idColumn,
  newId,
  opaqueBytes,
  opaqueColumn,
  opaqueUtf8,
  signedBigint,
  utcColumn,
  utcDateTime,
  utcIso,
} from "./core/values.js";

function discardConnection(connection: PoolConnection): void {
  // mysql2 3.24.6 destroy() only calls stream.end(); force-close a half-open peer too.
  // The pinned driver's stream exists at runtime but is absent from its promise types.
  const driver = connection.connection as typeof connection.connection & {
    stream: { destroy(): void };
  };
  connection.destroy();
  driver.stream.destroy();
}

export const expectedMysqlVersion = "8.4.11";
export const requiredSqlModes = [
  "ONLY_FULL_GROUP_BY",
  "STRICT_TRANS_TABLES",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
] as const;

export interface DatabaseSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createDatabase(settings: DatabaseSettings) {
  const options: PoolOptions = {
    ...settings,
    connectionLimit: 5,
    waitForConnections: false,
    connectTimeout: 1000,
    timezone: "Z",
    charset: "utf8mb4_0900_ai_ci",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
  };
  const pool = createPool(options);
  return {
    async check(): Promise<boolean> {
      const connection = await pool.getConnection();
      let reusable = false;
      try {
        await connection.query({ sql: "SET SESSION time_zone = '+00:00'", timeout: 1000 });
        const [rows] = await connection.query<RowDataPacket[]>({
          sql:
            "SELECT VERSION() AS version, @@session.time_zone AS timezone, " +
            "@@global.time_zone AS serverTimezone, @@default_storage_engine AS engineName, " +
            "@@session.sql_mode AS sqlMode, @@session.transaction_isolation AS isolationLevel, " +
            "@@character_set_database AS charsetName, @@collation_database AS collationName",
          timeout: 1000,
        });
        reusable = true;
        const row = rows[0];
        if (!row) return false;
        const modes = String(row.sqlMode).split(",");
        return (
          row.version === expectedMysqlVersion &&
          row.timezone === "+00:00" &&
          row.serverTimezone === "+00:00" &&
          row.engineName === "InnoDB" &&
          row.isolationLevel === "REPEATABLE-READ" &&
          row.charsetName === "utf8mb4" &&
          row.collationName === "utf8mb4_0900_ai_ci" &&
          requiredSqlModes.every((mode) => modes.includes(mode))
        );
      } finally {
        // A query timeout does not cancel the wire operation; never reuse that socket.
        if (reusable) connection.release();
        else discardConnection(connection);
      }
    },
    close: () => pool.end(),
  };
}
