import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const example = new URL("../.env.example", import.meta.url);
const destination = new URL("../.env", import.meta.url);
const contents = (await readFile(example, "utf8"))
  .replace("REPLACE_WITH_GENERATED_LOCAL_PASSWORD", randomBytes(32).toString("hex"))
  .replace("REPLACE_WITH_GENERATED_LOCAL_IDENTITY_SECRET", randomBytes(32).toString("hex"))
  .replace("REPLACE_WITH_GENERATED_LOCAL_ROOT_PASSWORD", randomBytes(32).toString("hex"));
try {
  await writeFile(destination, contents, { flag: "wx", mode: 0o600 });
  console.log("Created private .env for local development. No credentials were printed.");
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  console.log("Kept existing .env. Compare its field names with .env.example after updates.");
}
