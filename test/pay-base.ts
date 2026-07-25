/**
 * Test real payment flow on Base mainnet.
 *
 * Uses a funded wallet to pay for an API call via x402 protocol.
 * The x402 fetch wrapper handles 402 → sign permit → retry automatically.
 *
 * Run: npx tsx test/pay-base.ts
 */

import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3402";
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;

if (!PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(PRIVATE_KEY)) {
  console.error("Set EVM_PRIVATE_KEY to a 32-byte 0x-prefixed private key");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
console.log(`Payer wallet: ${account.address}`);
console.log(`Gateway: ${GATEWAY}\n`);

// Set up x402 client with EVM signer for Base (eip155:8453)
const client = new x402Client();
registerExactEvmScheme(client, {
  signer: account,
  networks: ["eip155:8453"],
});

// Wrap fetch with logging to see what's happening
const loggingFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  console.log(`  [fetch] ${init?.method || "GET"} ${url}`);
  if (init?.headers) {
    const h = new Headers(init.headers);
    const ps = h.get("payment-signature") || h.get("x-payment");
    if (ps) console.log(`  [fetch] payment-signature header present (${ps.length} chars)`);
  }
  const res = await fetch(input, init);
  console.log(`  [fetch] -> ${res.status}`);
  return res;
};

const fetchWithPay = wrapFetchWithPayment(loggingFetch, client);

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    console.error(`  FAIL: ${name} — ${err.message}`);
    if (err.cause) console.error(`    cause: ${err.cause}`);
  }
}

async function run() {
  // First: try to create payment directly to see errors
  console.log("--- Testing payment creation directly ---");
  const rawRes = await fetch(`${GATEWAY}/api/crypto/price?ids=bitcoin&currencies=usd`);
  const payHeader = rawRes.headers.get("payment-required");
  if (payHeader) {
    const decoded = JSON.parse(atob(payHeader));
    console.log(`Networks: ${decoded.accepts?.map((a: any) => a.network).join(", ")}`);

    // Try creating payment manually — pass the full paymentRequired object
    try {
      const paymentRequired = {
        x402Version: decoded.x402Version || 2,
        paymentRequirements: decoded.accepts.map((a: any) => ({ ...a, x402Version: 2 })),
      };
      console.log(`PaymentRequired: ${JSON.stringify(paymentRequired).slice(0, 300)}`);
      const payload = await client.createPaymentPayload(paymentRequired as any);
      console.log(`Payment payload created: ${JSON.stringify(payload).slice(0, 200)}`);
    } catch (e: any) {
      console.log(`Payment creation FAILED: ${e.message}`);
      console.log(`Stack: ${e.stack?.split("\n").slice(0, 5).join("\n")}`);
    }
  }
  console.log("---\n");

  // Test 1: Crypto price (cheapest at $0.001)
  await test("GET /api/crypto/price — paid $0.001 USDC on Base", async () => {
    const res = await fetchWithPay(
      `${GATEWAY}/api/crypto/price?ids=bitcoin,ethereum&currencies=usd`,
    );
    console.log(`    Response status: ${res.status}`);
    console.log(`    Response headers: ${[...res.headers.entries()].map(([k,v]) => `${k}=${v.slice(0,60)}`).join(", ")}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Status ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    console.log(`    BTC: $${data.data?.bitcoin?.usd ?? data.bitcoin?.usd}`);
    console.log(`    ETH: $${data.data?.ethereum?.usd ?? data.ethereum?.usd}`);
  });

  // Test 2: Crypto trending ($0.001)
  await test("GET /api/crypto/trending — paid $0.001 USDC on Base", async () => {
    const res = await fetchWithPay(`${GATEWAY}/api/crypto/trending`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Status ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const coins = data.data?.coins || data.coins || [];
    console.log(`    Top trending: ${coins.slice(0, 3).map((c: any) => c.item?.name || c.name).join(", ")}`);
  });

  // Test 3: IPFS pin ($0.01)
  await test("POST /api/ipfs/pin — paid $0.01 USDC on Base", async () => {
    const res = await fetchWithPay(`${GATEWAY}/api/ipfs/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { test: "x402 payment works!", timestamp: Date.now() },
        name: "payment-test.json",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Status ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    console.log(`    CID: ${data.data?.cid}`);
    console.log(`    IPFS: ${data.data?.ipfs_url}`);
  });

  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
