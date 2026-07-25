export interface DiscoveryParameter {
  type?: string;
  required?: boolean;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  items?: DiscoveryParameter;
  properties?: Record<string, DiscoveryParameter>;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean;
}

const JSON_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
]);

function inferSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      type: "array",
      ...(value.length > 0 ? { items: inferSchema(value[0]) } : {}),
    };
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    return {
      type: "object",
      properties: Object.fromEntries(
        entries.map(([name, property]) => [name, inferSchema(property)]),
      ),
      required: entries.map(([name]) => name),
      additionalProperties: false,
    };
  }

  return {
    type: value === null ? "string" : typeof value,
    ...(value !== null ? { example: value } : {}),
  };
}

export function buildParameterSchema(
  parameter: DiscoveryParameter,
): Record<string, unknown> {
  const type = JSON_SCHEMA_TYPES.has(parameter.type ?? "")
    ? parameter.type
    : "string";
  const schema: Record<string, unknown> = { type };

  if (parameter.description) schema.description = parameter.description;
  if (parameter.enum) schema.enum = parameter.enum;
  if (parameter.default !== undefined) schema.default = parameter.default;
  if (parameter.example !== undefined) schema.example = parameter.example;

  if (type === "array") {
    if (parameter.items) {
      schema.items = buildParameterSchema(parameter.items);
    } else if (Array.isArray(parameter.example) && parameter.example.length > 0) {
      schema.items = inferSchema(parameter.example[0]);
    }

    const minItems = parameter.minItems ?? (parameter.required ? 1 : undefined);
    if (minItems !== undefined) schema.minItems = minItems;
    if (parameter.maxItems !== undefined) schema.maxItems = parameter.maxItems;
  }

  if (type === "object" && parameter.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(parameter.properties).map(([name, property]) => [
        name,
        buildParameterSchema(property),
      ]),
    );
    const required = Object.entries(parameter.properties)
      .filter(([, property]) => property.required)
      .map(([name]) => name);
    if (required.length > 0) schema.required = required;
  }

  if (parameter.additionalProperties !== undefined) {
    schema.additionalProperties = parameter.additionalProperties;
  }

  return schema;
}

export function hasRequiredInput(
  parameters: Record<string, DiscoveryParameter>,
  requiredAnyOf: string[][] = [],
) {
  return (
    Object.values(parameters).some((parameter) => parameter.required) ||
    requiredAnyOf.length > 0
  );
}

export function buildInputObjectSchema(
  parameters: Record<string, DiscoveryParameter>,
  requiredAnyOf: string[][] = [],
) {
  const required = Object.entries(parameters)
    .filter(([, parameter]) => parameter.required)
    .map(([name]) => name);

  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(parameters).map(([name, parameter]) => [
        name,
        buildParameterSchema(parameter),
      ]),
    ),
    ...(required.length > 0 ? { required } : {}),
    ...(requiredAnyOf.length > 0
      ? { anyOf: requiredAnyOf.map((fields) => ({ required: fields })) }
      : {}),
    additionalProperties: false,
  };
}
