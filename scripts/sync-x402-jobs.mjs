const apiKey = process.env.X402_JOBS_API_KEY;

if (!apiKey) {
  console.error("X402_JOBS_API_KEY is required.");
  process.exit(1);
}

const discoveryUrl = "https://x402engine.app/.well-known/x402.json";
const bulkUrl = "https://api.x402.jobs/api/v1/resources/bulk";
const batchSize = 25;
const maxRetries = 3;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function postBatch(batch, batchLabel) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(bulkUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ resources: batch }),
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      return body;
    }

    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = Number(
        response.headers.get("retry-after") ?? body.retryAfter ?? 60,
      );
      const waitSeconds = Number.isFinite(retryAfter) ? retryAfter + 1 : 61;
      console.log(
        `${batchLabel} rate limited; retrying in ${waitSeconds} seconds.`,
      );
      await sleep(waitSeconds * 1_000);
      continue;
    }

    throw new Error(
      `${batchLabel} failed: HTTP ${response.status} ${JSON.stringify(body)}`,
    );
  }
}

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

const totals = {
  total: resources.length,
  created: 0,
  updated: 0,
  skipped: 0,
  errored: 0,
};
let failedResources = [];

for (let offset = 0; offset < resources.length; offset += batchSize) {
  const batch = resources.slice(offset, offset + batchSize);
  const batchLabel = `Batch ${offset / batchSize + 1}`;
  const body = await postBatch(batch, batchLabel);

  const summary = body.summary ?? {};
  for (const key of ["created", "updated", "skipped"]) {
    totals[key] += Number(summary[key] ?? 0);
  }

  console.log(`${batchLabel}: ${JSON.stringify(summary)}`);

  const failures = (body.results ?? []).filter(
    (result) => result.status === "error" || result.error,
  );
  for (const failure of failures) {
    console.error(JSON.stringify(failure));
    if (Number.isInteger(failure.index) && batch[failure.index]) {
      failedResources.push(batch[failure.index]);
    }
  }
}

for (let retry = 1; failedResources.length > 0 && retry <= maxRetries; retry += 1) {
  const retryQueue = failedResources;
  failedResources = [];

  for (let offset = 0; offset < retryQueue.length; offset += batchSize) {
    const batch = retryQueue.slice(offset, offset + batchSize);
    const batchLabel = `Resource retry ${retry}`;
    const body = await postBatch(batch, batchLabel);
    const summary = body.summary ?? {};

    for (const key of ["created", "updated", "skipped"]) {
      totals[key] += Number(summary[key] ?? 0);
    }

    console.log(`${batchLabel}: ${JSON.stringify(summary)}`);
    for (const result of body.results ?? []) {
      if (
        (result.status === "error" || result.error) &&
        Number.isInteger(result.index) &&
        batch[result.index]
      ) {
        console.error(JSON.stringify(result));
        failedResources.push(batch[result.index]);
      }
    }
  }
}

totals.errored = failedResources.length;
console.log(`x402.jobs sync complete: ${JSON.stringify(totals)}`);
if (totals.errored > 0) {
  process.exitCode = 1;
}
