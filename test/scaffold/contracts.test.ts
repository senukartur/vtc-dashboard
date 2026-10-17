import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

interface Content {
  content: Record<string, { schema: object }>;
}
interface Operation {
  operationId: string;
  responses: Record<string, Content | { $ref: string }>;
  requestBody?: Content;
}
interface Fixture {
  id: string;
  operationId: string;
  status: number;
  request?: unknown;
  response: unknown;
}

test("the runtime schema engine accepts every reviewed structural browser fixture", async () => {
  const spec = JSON.parse(
    await readFile(new URL("../../docs/contracts/dashboard/openapi.json", import.meta.url), "utf8"),
  ) as {
    paths: Record<string, Record<string, Operation>>;
    components: { responses: Record<string, Content> };
  };
  const fixtures = JSON.parse(
    await readFile(
      new URL("../../docs/contracts/dashboard/examples.json", import.meta.url),
      "utf8",
    ),
  ) as { cases: Fixture[] };
  const operations = new Map(
    Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods).map((operation) => [operation.operationId, operation] as const),
    ),
  );
  const ajv = createSchemaValidator();
  function check(schema: object, value: unknown, label: string) {
    const runtimeSchema = JSON.parse(
      JSON.stringify(schema).replaceAll("#/components/schemas/", "urn:vtc:browser:v1#/$defs/"),
    );
    const validate = ajv.compile(runtimeSchema);
    assert.ok(validate(value), `${label}: ${ajv.errorsText(validate.errors)}`);
  }
  for (const fixture of fixtures.cases) {
    const operation = operations.get(fixture.operationId);
    assert.ok(operation, fixture.id);
    let response = operation.responses[fixture.status] ?? operation.responses.default;
    assert.ok(response, fixture.id);
    if ("$ref" in response)
      response = spec.components.responses[response.$ref.split("/").at(-1) ?? ""];
    assert.ok(response && "content" in response, fixture.id);
    const json = response.content["application/json"];
    assert.ok(json, fixture.id);
    check(json.schema, fixture.response, fixture.id);
    if ("request" in fixture) {
      assert.ok(operation.requestBody, fixture.id);
      const media = Object.values(operation.requestBody.content)[0];
      assert.ok(media, fixture.id);
      check(media.schema, fixture.request, `${fixture.id} request`);
    }
  }
});
