import { createSchemaValidator } from "./schemas.js";

export const browserRef = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const stage3View = { type: "string", const: "stage3" } as const;
export const stage3Query = {
  type: "object",
  properties: { view: stage3View },
  required: ["view"],
  additionalProperties: false,
} as const;

export function stage3QuerySelection(
  legacy: object,
  enabled: boolean,
  stage3: object = stage3Query,
) {
  return enabled ? { anyOf: [legacy, stage3] } : legacy;
}

// Fastify selects the response serializer by status, so bind the exact schema
// to the validated query selector even where the two closed envelopes overlap.
const ajv = createSchemaValidator();
export function stage3Envelope(legacy: string, stage3: string) {
  const shapes = [ajv.compile(browserRef(legacy)), ajv.compile(browserRef(stage3))] as const;
  return (staged: boolean, envelope: object) => {
    const validate = shapes[staged ? 1 : 0];
    if (!validate(envelope)) throw new Error("RESPONSE_SCHEMA_INVALID");
    return envelope;
  };
}
