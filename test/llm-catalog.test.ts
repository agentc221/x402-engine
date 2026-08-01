import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Service = {
  id: string;
  path: string;
};

const services = JSON.parse(readFileSync("config/services.json", "utf8")).services as Service[];
const llmServices = services.filter((service) => service.path.startsWith("/api/llm/"));
const llmSource = readFileSync("src/apis/llm.ts", "utf8");

const routeSlugs = new Set(
  [...llmSource.matchAll(/"([^"]+)": \{ model:/g)].map((match) => match[1]),
);

const routeServiceIds = new Set(
  [...llmSource.matchAll(/serviceId: "([^"]+)"/g)].map((match) => match[1]),
);

const routeModels = new Map(
  [...llmSource.matchAll(/"([^"]+)": \{ model: "([^"]+)"/g)].map((match) => [
    match[1],
    match[2],
  ]),
);

const catalogServiceIds = new Set(llmServices.map((service) => service.id));
const newModels = {
  "claude-opus-5": "anthropic/claude-opus-5",
  "claude-opus-5-fast": "anthropic/claude-opus-5-fast",
  "claude-sonnet-5": "anthropic/claude-sonnet-5",
  "gemini-3.6-flash": "google/gemini-3.6-flash",
  "gemini-3.5-flash-lite": "google/gemini-3.5-flash-lite",
  "kimi-k3": "moonshotai/kimi-k3",
  "grok-4.5": "x-ai/grok-4.5",
  "kat-coder-air-v2.5": "kwaipilot/kat-coder-air-v2.5",
  "kat-coder-pro-v2.5": "kwaipilot/kat-coder-pro-v2.5",
  "longcat-2": "meituan/longcat-2.0",
  "inkling": "thinkingmachines/inkling",
  "muse-spark-1.1": "meta/muse-spark-1.1",
  "aion-3.0": "aion-labs/aion-3.0",
  "aion-3.0-mini": "aion-labs/aion-3.0-mini",
  "hy3": "tencent/hy3",
  "ling-3-flash": "inclusionai/ling-3.0-flash:free",
  "gpt-5.6-luna": "openai/gpt-5.6-luna",
  "gpt-5.6-luna-pro": "openai/gpt-5.6-luna-pro",
  "gpt-5.6-terra": "openai/gpt-5.6-terra",
  "gpt-5.6-terra-pro": "openai/gpt-5.6-terra-pro",
  "gpt-5.6-sol": "openai/gpt-5.6-sol",
  "gpt-5.6-sol-pro": "openai/gpt-5.6-sol-pro",
  "deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
};

describe("LLM catalog", () => {
  it("registers every configured LLM service route", () => {
    const missingRoutes = llmServices
      .map((service) => service.path.replace("/api/llm/", ""))
      .filter((slug) => !routeSlugs.has(slug));

    expect(missingRoutes).toEqual([]);
  });

  it("uses service IDs that exist in the paid service catalog", () => {
    const missingServiceIds = [...routeServiceIds].filter((id) => !catalogServiceIds.has(id));
    const unroutedServiceIds = [...catalogServiceIds].filter((id) => !routeServiceIds.has(id));

    expect(missingServiceIds).toEqual([]);
    expect(unroutedServiceIds).toEqual([]);
  });

  it("includes the current OpenRouter model additions", () => {
    expect(Object.fromEntries(
      Object.keys(newModels).map((slug) => [slug, routeModels.get(slug)]),
    )).toEqual(newModels);
  });

  it("documents every current model addition on all public catalog surfaces", () => {
    const publicCatalogs = [
      readFileSync("public/index.html", "utf8"),
      readFileSync("public/docs/index.html", "utf8"),
      readFileSync("public/llms.txt", "utf8"),
    ];

    for (const slug of Object.keys(newModels)) {
      for (const catalog of publicCatalogs) {
        expect(catalog).toContain(`/api/llm/${slug}`);
      }
    }
  });

  it("does not include excluded Laguna routes", () => {
    expect(llmSource).not.toContain("poolside/laguna");
    expect(JSON.stringify(llmServices)).not.toContain("laguna");
  });

  it("does not advertise stale Grok 4 Fast routes", () => {
    expect(llmSource).not.toContain("grok-4-fast");
    expect(JSON.stringify(llmServices)).not.toContain("grok-4-fast");
  });

  it("does not point routes at deprecated or unavailable OpenRouter model IDs", () => {
    expect(llmSource).not.toContain("x-ai/grok-4\"");
    expect(llmSource).not.toContain("x-ai/grok-code-fast-1");
    expect(llmSource).not.toContain("google/gemini-3-pro-preview");
    expect(llmSource).not.toContain("deepseek/deepseek-v3.2-speciale");
  });
});
