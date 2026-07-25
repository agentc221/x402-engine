import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

interface DiscoveryParameter {
  type?: string;
  required?: boolean;
  description?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
}

interface DiscoverableService {
  method: string;
  parameters?: {
    body?: Record<string, DiscoveryParameter>;
    query?: Record<string, DiscoveryParameter>;
  };
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const JSON_SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object"]);

function buildInputSchema(parameters: Record<string, DiscoveryParameter>) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const [name, parameter] of Object.entries(parameters)) {
    const property: Record<string, unknown> = {
      type: JSON_SCHEMA_TYPES.has(parameter.type ?? "") ? parameter.type : "string",
    };

    if (parameter.description) property.description = parameter.description;
    if (parameter.enum) property.enum = parameter.enum;
    if (parameter.default !== undefined) property.default = parameter.default;
    if (parameter.example !== undefined) property.example = parameter.example;
    if (parameter.required) required.push(name);

    properties[name] = property;
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

export function buildBazaarExtensions(service: DiscoverableService) {
  const method = service.method.toUpperCase();
  const usesBody = BODY_METHODS.has(method);
  const parameters = usesBody
    ? (service.parameters?.body ?? {})
    : (service.parameters?.query ?? {});
  const input = Object.fromEntries(
    Object.entries(parameters).flatMap(([name, parameter]) => {
      const value = parameter.example ?? parameter.default;
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const inputSchema = buildInputSchema(parameters);

  if (usesBody) {
    return declareDiscoveryExtension({
      input,
      inputSchema,
      bodyType: "json",
    });
  }

  return declareDiscoveryExtension({
    input,
    inputSchema,
  });
}
