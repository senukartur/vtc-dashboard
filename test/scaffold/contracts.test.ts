import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

interface Content {
  content: Record<string, { schema: object }>;
}
type OperationExtension = "x-stage-2-operation" | "x-stage-3-operation";
interface Parameter {
  in: string;
  name: string;
  required?: boolean;
  schema: object;
}
interface WireOperation {
  parameters?: (Parameter | { $ref: string })[];
  responses: Record<string, Content | { $ref: string }>;
  requestBody?: Content;
}
type Operation = WireOperation & { operationId: string; "x-contract-stage"?: string } & Partial<
    Record<OperationExtension, WireOperation>
  >;
interface Fixture {
  id: string;
  operationId: string;
  status: number;
  operationExtension?: OperationExtension;
  request?: unknown;
  query?: unknown;
  response: unknown;
}

test("the runtime schema engine accepts every reviewed structural browser fixture", async () => {
  const spec = JSON.parse(
    await readFile(new URL("../../docs/contracts/dashboard/openapi.json", import.meta.url), "utf8"),
  ) as {
    paths: Record<string, Record<string, Operation>>;
    components: { parameters: Record<string, Parameter>; responses: Record<string, Content> };
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
    const activeOperation = operations.get(fixture.operationId);
    const operation = fixture.operationExtension
      ? activeOperation?.[fixture.operationExtension]
      : activeOperation;
    assert.ok(operation, fixture.id);
    let response = operation.responses[fixture.status] ?? operation.responses.default;
    assert.ok(response, fixture.id);
    if ("$ref" in response)
      response = spec.components.responses[response.$ref.split("/").at(-1) ?? ""];
    assert.ok(response && "content" in response, fixture.id);
    const json = response.content["application/json"];
    assert.ok(json, fixture.id);
    check(json.schema, fixture.response, fixture.id);
    if (
      "query" in fixture &&
      (fixture.operationExtension === "x-stage-3-operation" ||
        activeOperation?.["x-contract-stage"] === "VTC-139 Step 1")
    ) {
      const query = (operation.parameters ?? []).flatMap((parameter) => {
        const resolved =
          "$ref" in parameter
            ? spec.components.parameters[parameter.$ref.split("/").at(-1) ?? ""]
            : parameter;
        assert.ok(resolved, fixture.id);
        return resolved.in === "query" ? [resolved] : [];
      });
      check(
        {
          type: "object",
          properties: Object.fromEntries(query.map(({ name, schema }) => [name, schema])),
          required: query.filter(({ required }) => required).map(({ name }) => name),
          additionalProperties: false,
        },
        fixture.query,
        `${fixture.id} query`,
      );
    }
    if ("request" in fixture) {
      assert.ok(operation.requestBody, fixture.id);
      const media = Object.values(operation.requestBody.content)[0];
      assert.ok(media, fixture.id);
      check(media.schema, fixture.request, `${fixture.id} request`);
    }
  }
});
