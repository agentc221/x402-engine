import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bazaarResourceServerExtension,
  validateDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { buildBazaarExtensions } from "../src/services/bazaar.js";

interface ServiceDefinition {
  id: string;
  method: string;
  parameters?: {
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  };
}

const { services } = JSON.parse(readFileSync("config/services.json", "utf8")) as {
  services: ServiceDefinition[];
};

describe("Coinbase Bazaar discovery", () => {
  it("declares valid discovery metadata for every paid route", async () => {
    expect(services).toHaveLength(108);

    for (const service of services) {
      const extensions = buildBazaarExtensions(service);
      expect(extensions).toHaveProperty("bazaar");

      const enriched = await bazaarResourceServerExtension.enrichDeclaration?.(
        extensions.bazaar,
        {
          method: service.method.toUpperCase(),
          adapter: {},
        } as never,
      );
      const result = validateDiscoveryExtension(
        enriched as typeof extensions.bazaar,
      );
      expect(result, `${service.id}: ${result.errors?.join(", ")}`).toMatchObject({
        valid: true,
      });
    }
  });

  it("uses JSON bodies for write routes and query parameters for GET routes", () => {
    for (const service of services) {
      const extension = buildBazaarExtensions(service).bazaar;
      const input = extension.info.input;

      if (["POST", "PUT", "PATCH"].includes(service.method.toUpperCase())) {
        expect(input).toHaveProperty("bodyType", "json");
        expect(input).toHaveProperty("body");
        expect(input).not.toHaveProperty("queryParams");
      } else {
        expect(input).toHaveProperty("queryParams");
        expect(input).not.toHaveProperty("body");
      }
    }
  });

  it("includes examples for every required input", () => {
    for (const service of services) {
      const extension = buildBazaarExtensions(service).bazaar;
      const input = extension.info.input as {
        body?: Record<string, unknown>;
        queryParams?: Record<string, unknown>;
      };
      const values = input.body ?? input.queryParams ?? {};
      const schema = service.method === "GET"
        ? service.parameters?.query
        : service.parameters?.body;

      for (const [name, parameter] of Object.entries(schema ?? {})) {
        if ((parameter as { required?: boolean }).required) {
          expect(values, `${service.id}.${name}`).toHaveProperty(name);
        }
      }
    }
  });
});
