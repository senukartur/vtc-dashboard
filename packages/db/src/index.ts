import { createPool, type PoolOptions, type RowDataPacket } from "mysql2/promise";

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
    connectTimeout: 2000,
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
      try {
        await connection.query("SET SESSION time_zone = '+00:00'");
        const [rows] = await connection.query<RowDataPacket[]>(
          "SELECT VERSION() AS version, @@session.time_zone AS timezone, " +
            "@@global.time_zone AS serverTimezone, @@default_storage_engine AS engineName, " +
            "@@session.sql_mode AS sqlMode, @@session.transaction_isolation AS isolationLevel, " +
            "@@character_set_database AS charsetName, @@collation_database AS collationName",
        );
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
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}
