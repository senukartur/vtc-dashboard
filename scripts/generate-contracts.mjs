import { mkdir, readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const source = new URL("../docs/contracts/dashboard/openapi.json", import.meta.url);
const output = new URL("../packages/contracts/src/generated/", import.meta.url);
const spec = JSON.parse(await readFile(source, "utf8"));
const types = astToString(await openapiTS(spec, { alphabetize: true }));
const schemas = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:vtc:browser:v1",
    $defs: JSON.parse(
      JSON.stringify(spec.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
    ),
  },
  null,
  2,
);
const generated = [
  ["browser.ts", `// Generated from the reviewed OpenAPI. Do not edit by hand.\n${types}`],
  ["schemas.json", `${schemas}\n`],
];
await mkdir(output, { recursive: true });
for (const [name, contents] of generated) {
  const path = new URL(name, output);
  if (process.argv.includes("--check")) {
    const current = await readFile(path, "utf8").catch(() => null);
    if (current !== contents) throw new Error(`Generated contract is stale: ${name}`);
  } else {
    await writeFile(path, contents);
  }
}
console.log(
  process.argv.includes("--check")
    ? "Generated contracts match source."
    : "Generated browser types and draft-2020-12 schemas.",
);
