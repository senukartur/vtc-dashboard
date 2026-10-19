import { randomBytes } from "node:crypto";
import { chmod, chown, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Run on the new host as root, never in CI. Existing configuration is never overwritten.
const directory = resolve(process.argv[2] ?? ".", "private");
await mkdir(directory, { recursive: false, mode: 0o700 });
await mkdir(resolve(directory, "maintenance"), { mode: 0o700 });
await mkdir(resolve(directory, "bootstrap"), { mode: 0o750 });
await chown(resolve(directory, "bootstrap"), 0, 999);
const keys = Object.fromEntries(
  ["root", "runtime", "migrator", "export", "probe", "heartbeat", "jobs", "operator"].map((key) => [
    key,
    randomBytes(32).toString("hex"),
  ]),
);
async function save(name, content) {
  const file = resolve(directory, name);
  await writeFile(file, content, { flag: "wx", mode: 0o600 });
  await chmod(file, 0o600);
}
await save("db.env", `MYSQL_ROOT_PASSWORD=${keys.root}\nMYSQL_DATABASE=vtc\n`);
await save("admin.cnf", `[client]\nuser=root\npassword=${keys.root}\n`);
await save("export.cnf", `[client]\nuser=vtc_export\npassword=${keys.export}\n`);
for (const role of ["runtime", "migrator", "probe", "heartbeat", "jobs"]) {
  await save(
    `${role}.env`,
    `MYSQL_HOST=db\nMYSQL_PORT=3306\nMYSQL_DATABASE=${["probe", "heartbeat"].includes(role) ? "vtc_operations" : "vtc"}\nMYSQL_USER=vtc_${role}\nMYSQL_PASSWORD=${keys[role]}\n${role === "probe" ? `OPERATOR_TOKEN=${keys.operator}\n` : ""}`,
  );
}
await save("operator.env", `OPERATOR_TOKEN=${keys.operator}\n`);
await save(
  "identity-mail.env",
  "IDENTITY_ENABLED=false\nMAIL_MODE=disabled\nADMISSIONS_ENABLED=false\n",
);
await save(
  "proxy.env",
  "STAGING_DOMAIN=staging.example.invalid\nTLS_EMAIL=operator@example.invalid\n",
);
let sql =
  "CREATE DATABASE vtc_operations CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nCREATE TABLE vtc_operations.heartbeat (singleton TINYINT PRIMARY KEY, at_utc DATETIME(3) NOT NULL, sequence BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB;\nCREATE TABLE vtc_operations.synthetic_reference (singleton TINYINT PRIMARY KEY, evidence_sha CHAR(64) NOT NULL) ENGINE=InnoDB;\n";
for (const role of ["runtime", "migrator", "export", "probe", "heartbeat", "jobs"])
  sql += `CREATE USER 'vtc_${role}'@'%' IDENTIFIED BY '${keys[role]}';\n`;
sql +=
  "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON vtc.* TO 'vtc_migrator'@'%';\nGRANT SELECT,SHOW VIEW,TRIGGER ON vtc.* TO 'vtc_export'@'%';\nGRANT SELECT,SHOW VIEW,TRIGGER ON vtc_operations.* TO 'vtc_export'@'%';\nGRANT SELECT ON vtc_operations.heartbeat TO 'vtc_probe'@'%';\nGRANT SELECT,INSERT,UPDATE ON vtc_operations.heartbeat TO 'vtc_heartbeat'@'%';\n";
await save("bootstrap/init.sql", sql);
// The pinned MySQL image drops to uid/gid 999 before reading initialization files.
// Its dedicated bind mount can read this file; the host's enclosing private directory is 0700.
await chown(resolve(directory, "bootstrap/init.sql"), 0, 999);
await chmod(resolve(directory, "bootstrap/init.sql"), 0o640);
await save("maintenance/enabled", "MAINTENANCE\n");
console.log(
  "Private configuration created; configure DNS/TLS privately before starting the proxy.",
);
