import { browserSchemaDocument } from "@vtc/contracts/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { FastifyInstance } from "fastify";

export function createSchemaValidator(coerceTypes: false | "array" = false): Ajv2020 {
  const ajv = new Ajv2020({
    strict: true,
    coerceTypes,
    useDefaults: false,
    removeAdditional: false,
    allErrors: false,
  });
  addFormats.default(ajv);
  // File-byte validation belongs to the multipart boundary in VTC-025.
  ajv.addFormat("binary", { type: "string", validate: () => true });
  ajv.addSchema(browserSchemaDocument);
  return ajv;
}

export function installSchemaCompilers(app: FastifyInstance): void {
  const ajv = createSchemaValidator();
  const parameters = createSchemaValidator("array");
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === "body" ? ajv : parameters).compile(schema),
  );
  app.setSerializerCompiler(({ schema }) => {
    const validate = ajv.compile(schema);
    return (data) => {
      if (!validate(data)) throw new Error("RESPONSE_SCHEMA_INVALID");
      return JSON.stringify(data);
    };
  });
}
