import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  buildInputObjectSchema,
  type DiscoveryParameter,
} from "./schema.js";

interface DiscoverableService {
  method: string;
  parameters?: {
    body?: Record<string, DiscoveryParameter>;
    query?: Record<string, DiscoveryParameter>;
    bodyRequiredAnyOf?: string[][];
  };
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

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
  const inputSchema = buildInputObjectSchema(
    parameters,
    usesBody ? service.parameters?.bodyRequiredAnyOf : undefined,
  );

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
