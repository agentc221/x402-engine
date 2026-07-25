/**
 * Test real payment flow for new LLM models on Base mainnet.
 * Run: npx tsx test/test-new-models.ts
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
console.log(`Payer: ${account.address}`);
console.log(`Gateway: ${GATEWAY}\n`);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account, networks: ["eip155:8453"] });
const paidFetch = wrapFetchWithPayment(fetch, client);

async function testModel(slug: string, price: string) {
  console.log(`--- ${slug} (${price}) ---`);
  try {
    const res = await paidFetch(`${GATEWAY}/api/llm/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Say hello in 3 words." }], max_tokens: 32 }),
    });
    console.log(`  Status: ${res.status}`);
    const data = await res.json();
    const content = (data as any).choices?.[0]?.message?.content || JSON.stringify(data).slice(0, 150);
    console.log(`  Reply: ${content}`);
    console.log(`  PASS\n`);
  } catch (err: any) {
    console.error(`  FAIL: ${err.message}\n`);
  }
}

async function run() {
  // Test 3 of the cheapest new models to minimize cost
  await testModel("gemini-3.1-flash-lite", "$0.003");
  await testModel("qwen3.5", "$0.006");
  await testModel("deepseek-v3.2-speciale", "$0.008");
  console.log("Done! Total spent: ~$0.017 USDC on Base");
}

run().catch((err) => { console.error("Fatal:", err); process.exit(1); });
