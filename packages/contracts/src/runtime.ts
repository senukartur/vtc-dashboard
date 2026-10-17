import document from "./generated/schemas.json" with { type: "json" };

export const browserSchemaDocument: Record<string, unknown> = document;

export function browserSchemaRef(name: keyof typeof document.$defs): { $ref: string } {
  return { $ref: `urn:vtc:browser:v1#/$defs/${name}` };
}
