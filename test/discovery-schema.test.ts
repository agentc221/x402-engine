import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInputObjectSchema,
  hasRequiredInput,
} from "../src/services/schema.js";

const { services } = JSON.parse(readFileSync("config/services.json", "utf8"));

function bodySchema(serviceId: string) {
  const service = services.find(
    (candidate: { id: string }) => candidate.id === serviceId,
  );
  const body = service.parameters?.body ?? {};
  const requiredAnyOf = service.parameters?.bodyRequiredAnyOf ?? [];

  return {
    required: hasRequiredInput(body, requiredAnyOf),
    schema: buildInputObjectSchema(body, requiredAnyOf),
  };
}

describe("discovery request schemas", () => {
  it("requires one supported transcription input", () => {
    const { required, schema } = bodySchema("transcribe");

    expect(required).toBe(true);
    expect(schema.anyOf).toEqual([
      { required: ["audio_url"] },
      { required: ["audio_base64"] },
    ]);
  });

  it("requires one embeddings input and types text arrays", () => {
    const { required, schema } = bodySchema("embeddings");

    expect(required).toBe(true);
    expect(schema.anyOf).toEqual([
      { required: ["text"] },
      { required: ["texts"] },
    ]);
    expect(schema.properties.texts).toMatchObject({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 100,
    });
  });

  it("types LLM messages as non-empty role/content objects", () => {
    const { schema } = bodySchema("llm-gpt-4o");

    expect(schema.properties.messages).toMatchObject({
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["role", "content"],
        additionalProperties: false,
        properties: {
          role: { type: "string" },
          content: { type: "string" },
        },
      },
    });
  });
});
