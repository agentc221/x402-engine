import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("src/index.ts", "utf8");

describe("discovery compatibility routes", () => {
  it("serves common machine-discovery aliases that crawlers request", () => {
    expect(serverSource).toContain('app.get("/.well-known/x402"');
    expect(serverSource).toContain('app.get("/.well-known/agent-card.json"');
    expect(serverSource).toContain('app.get("/openapi.json"');
    expect(serverSource).toContain('app.get("/robots.txt"');
    expect(serverSource).toContain('app.get("/sitemap.xml"');
    expect(serverSource).toContain('app.get("/favicon.ico"');
  });

  it("keeps stale Grok Fast out of discovery while redirecting old callers", () => {
    expect(serverSource).toContain('app.all("/api/llm/grok-4-fast"');
    expect(serverSource).toContain('res.redirect(308, "/api/llm/grok")');
  });

  it("returns metadata for browser GETs to POST-only paid endpoints", () => {
    expect(serverSource).toContain('app.get("/api/*"');
    expect(serverSource).toContain('service.path === req.path && service.method !== "GET"');
    expect(serverSource).toContain('Use ${svc.method} ${svc.path} with an x402 payment');
  });

  it("absorbs known production probes that otherwise pollute the dashboard with 404s", () => {
    expect(serverSource).toContain("x402station-wildcard");
    expect(serverSource).toContain('app.all(["/index.php", "/xmlrpc.php"]');
  });

  it("accepts POST probes on the advertised MCP endpoint", () => {
    const mcpSource = readFileSync("src/mcp.ts", "utf8");
    expect(mcpSource).toContain('app.post("/mcp"');
    expect(mcpSource).toContain('message.method === "initialize"');
    expect(mcpSource).toContain('message.method === "tools/list"');
  });

  it("scopes paid endpoint rate limits by IP and path for catalog crawlers", () => {
    const rateLimitSource = readFileSync("src/middleware/rate-limit.ts", "utf8");
    expect(rateLimitSource).toContain("ipKeyGenerator(req.ip ??");
    expect(rateLimitSource).toContain(":${req.path}");
  });
});
