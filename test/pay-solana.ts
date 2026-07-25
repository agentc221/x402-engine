/**
 * Test real payment flow on Solana mainnet.
 *
 * Uses a funded wallet to pay for an API call via x402 protocol (USDC on Solana).
 * The x402 fetch wrapper handles 402 → sign tx → retry automatically.
 *
 * Setup:
 *   1. Export your Solana private key (32 bytes, base58):
 *      export SOLANA_PRIVATE_KEY=<base58-encoded-32-byte-key>
 *   2. Fund the wallet with a small amount of USDC on Solana mainnet (~$0.05)
 *      and a tiny amount of SOL for gas (~0.01 SOL)
 *   3. Run: GATEWAY_URL=https://x402engine.app npx tsx test/pay-solana.ts
 */

import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { getBase58Codec } from "@solana/codecs";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3402";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;

if (!SOLANA_PRIVATE_KEY) {
  console.error("Set SOLANA_PRIVATE_KEY env var (base58-encoded 32-byte private key)");
  process.exit(1);
}

async function main() {
  // Decode base58 private key to bytes
  const codec = getBase58Codec();
  const keyBytes = codec.encode(SOLANA_PRIVATE_KEY);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(keyBytes);

  console.log(`Payer wallet: ${signer.address}`);
  console.log(`Gateway: ${GATEWAY}\n`);

  // Set up x402 client with Solana signer
  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer,
    networks: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  });

  // Wrap fetch with logging
  const loggingFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    console.log(`  [fetch] ${init?.method || "GET"} ${url}`);
    if (init?.headers) {
      const h = new Headers(init.headers);
      const ps = h.get("x-payment");
      if (ps) console.log(`  [fetch] x-payment header present (${ps.length} chars)`);
    }
    const res = await fetch(input, init);
    console.log(`  [fetch] -> ${res.status}`);
    return res;
  };

  const fetchWithPay = wrapFetchWithPayment(loggingFetch, client);

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  PASS: ${name}\n`);
    } catch (err: any) {
      failed++;
      console.error(`  FAIL: ${name} — ${err.message}\n`);
    }
  }

  // Step 0: Verify 402 includes Solana mainnet
  await test("402 response includes Solana mainnet", async () => {
    const res = await fetch(`${GATEWAY}/api/crypto/price?ids=bitcoin&currencies=usd`);
    if (res.status !== 402) throw new Error(`Expected 402, got ${res.status}`);
    const payHeader = res.headers.get("payment-required");
    if (!payHeader) throw new Error("No PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(payHeader));
    const solana = decoded.accepts?.find((a: any) => a.network === "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    if (!solana) {
      const networks = decoded.accepts?.map((a: any) => a.network).join(", ");
      throw new Error(`Solana mainnet not in accepts. Found: ${networks}`);
    }
    console.log(`    Solana USDC amount for $0.001: ${solana.amount}`);
    console.log(`    PayTo: ${solana.payTo}`);
  });

  // Test 1: Crypto price (cheapest at $0.001 USDC on Solana)
  await test("GET /api/crypto/price — paid $0.001 USDC on Solana", async () => {
    const res = await fetchWithPay(
      `${GATEWAY}/api/crypto/price?ids=bitcoin,ethereum&currencies=usd`,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Status ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const btc = data.data?.bitcoin?.usd ?? data.bitcoin?.usd;
    const eth = data.data?.ethereum?.usd ?? data.ethereum?.usd;
    console.log(`    BTC: $${btc}`);
    console.log(`    ETH: $${eth}`);
    if (!btc || !eth) throw new Error("Missing price data");
  });

  // Test 2: Crypto trending ($0.001)
  await test("GET /api/crypto/trending — paid $0.001 USDC on Solana", async () => {
    const res = await fetchWithPay(`${GATEWAY}/api/crypto/trending`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Status ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const coins = data.data?.coins || data.coins || [];
    console.log(`    Top trending: ${coins.slice(0, 3).map((c: any) => c.item?.name || c.name).join(", ")}`);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
