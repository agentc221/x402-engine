const apiKey = process.env.X402_JOBS_API_KEY;

if (!apiKey) {
  console.error("X402_JOBS_API_KEY is required.");
  process.exit(1);
}

const discoveryUrl = "https://x402engine.app/.well-known/x402.json";
const bulkUrl = "https://api.x402.jobs/api/v1/resources/bulk";
const batchSize = 25;

const discoveryResponse = await fetch(discoveryUrl);
if (!discoveryResponse.ok) {
  throw new Error(`Discovery request failed: HTTP ${discoveryResponse.status}`);
}

const discovery = await discoveryResponse.json();
if (!Array.isArray(discovery.services) || discovery.services.length === 0) {
  throw new Error("Discovery document does not contain any services.");
}

const resources = discovery.services.map((service) => ({
  name: `x402engine/${service.id}`,
  description: service.description,
  resource_url: service.endpoint,
  category: service.category || "api",
  tags: [
    "x402",
    service.category || "api",
    service.method.toLowerCase(),
    "base",
    "megaeth",
    "solana",
  ],
  capabilities: [service.name, service.description],
  server_name: "x402engine",
  extra: {
    service_id: service.id,
    method: service.method,
    price: service.price,
    discovery_url: discoveryUrl,
  },
}));

const totals = { total: 0, created: 0, updated: 0, skipped: 0, errored: 0 };

for (let offset = 0; offset < resources.length; offset += batchSize) {
  const batch = resources.slice(offset, offset + batchSize);
  const response = await fetch(bulkUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ resources: batch }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Batch ${offset / batchSize + 1} failed: HTTP ${response.status} ${JSON.stringify(body)}`,
    );
  }

  const summary = body.summary ?? {};
  for (const key of Object.keys(totals)) {
    totals[key] += Number(summary[key] ?? 0);
  }

  console.log(
    `Batch ${offset / batchSize + 1}: ${JSON.stringify(summary)}`,
  );

  const failures = (body.results ?? []).filter(
    (result) => result.status === "error" || result.error,
  );
  for (const failure of failures) {
    console.error(JSON.stringify(failure));
  }
}

console.log(`x402.jobs sync complete: ${JSON.stringify(totals)}`);
if (totals.errored > 0) {
  process.exitCode = 1;
}
