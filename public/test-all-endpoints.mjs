#!/usr/bin/env node
/**
 * x402engine — full paid endpoint sweep
 * Pulls all endpoints from discovery, tests each with real payments.
 *
 * Usage: node test-all-endpoints.mjs
 *
 * Env (all optional — defaults to secrets dir):
 *   BASE_KEY=0x...        EVM private key for Base (USDC)
 *   MEGA_KEY=0x...        EVM private key for MegaETH (USDm)
 *   SOL_KEYPAIR=path      Solana keypair JSON file
 *   RAILS=base,megaeth,sol  Comma-separated rails to test (default: all funded)
 *   SOLANA_RPC_URL=...    Solana RPC (default: env or public)
 */

import { readFileSync, existsSync } from 'node:fs';
import { x402Client, wrapFetchWithPayment, wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, createPublicClient, http, getAddress, parseGwei } from 'viem';

const DISCOVERY = 'https://x402engine.app/.well-known/x402.json';
const SECRETS = '/Users/moltboyxd/.openclaw/workspace/.secrets';
const TIMEOUT_MS = 20000;

// ── Wallet loading ──────────────────────────────────────────────────

function loadEvmKey(envVar, secretFile) {
  if (process.env[envVar]) return process.env[envVar];
  const p = `${SECRETS}/${secretFile}`;
  if (!existsSync(p)) return null;
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const raw = Array.isArray(d) ? (d[0].private_key || d[0].privateKey) : (d.privateKey || d.private_key);
  return raw?.startsWith('0x') ? raw : `0x${raw}`;
}

const baseKey = loadEvmKey('BASE_KEY', 'eth-wallet.json');
const megaKey = loadEvmKey('MEGA_KEY', 'megaeth-deployer.json');
const solKeypairPath = process.env.SOL_KEYPAIR || `${SECRETS}/solana-paygate-keypair.json`;

// ── MegaETH custom scheme ───────────────────────────────────────────

const megaethChain = {
  id: 4326, name: 'MegaETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.megaeth.com/rpc'] } },
};

const erc20TransferAbi = [{
  type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}];

class MegaethScheme {
  constructor(walletClient, publicClient) {
    this.scheme = 'exact';
    this.wc = walletClient;
    this.pc = publicClient;
    this.nonce = null;
    this.queue = Promise.resolve();
  }
  createPaymentPayload(x402Version, req) {
    const run = async () => {
      const to = getAddress(req.payTo);
      const token = getAddress(req.asset);
      const value = BigInt(req.amount);
      // Re-fetch nonce on first call or after error
      if (this.nonce === null)
        this.nonce = await this.pc.getTransactionCount({ address: this.wc.account.address });
      try {
        const txHash = await this.wc.writeContract({
          address: token, abi: erc20TransferAbi, functionName: 'transfer',
          args: [to, value], nonce: this.nonce,
          maxFeePerGas: parseGwei('0.001'), maxPriorityFeePerGas: 0n,
          gas: 200000n, chain: megaethChain, account: this.wc.account,
        });
        await this.pc.waitForTransactionReceipt({ hash: txHash, timeout: 5000 });
        this.nonce++;
        return { x402Version, payload: { txHash } };
      } catch (e) {
        // Reset nonce so next call re-fetches from chain
        this.nonce = null;
        throw e;
      }
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }
}

// ── Build fetchers per rail ─────────────────────────────────────────

const rails = {};

if (baseKey) {
  try {
    const acct = privateKeyToAccount(baseKey);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: acct, networks: ['eip155:8453'] });
    rails.base = {
      network: 'eip155:8453',
      fetch: wrapFetchWithPayment(fetch, client, {
        paymentRequirementsSelector: (a) => a.find(x => x.network === 'eip155:8453'),
      }),
      addr: acct.address,
    };
  } catch (e) { console.log(`[base] skip: ${e.message}`); }
}

if (megaKey) {
  try {
    const acct = privateKeyToAccount(megaKey);
    const transport = http('https://mainnet.megaeth.com/rpc');
    const scheme = new MegaethScheme(
      createWalletClient({ account: acct, chain: megaethChain, transport }),
      createPublicClient({ chain: megaethChain, transport }),
    );
    rails.megaeth = {
      network: 'eip155:4326',
      fetch: wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: 'eip155:4326', client: scheme }],
      }),
      addr: acct.address,
    };
  } catch (e) { console.log(`[mega] skip: ${e.message}`); }
}

if (existsSync(solKeypairPath)) {
  try {
    const { ExactSvmScheme, SOLANA_MAINNET_CAIP2 } = await import('@x402/svm');
    const { createKeyPairSignerFromBytes } = await import('@solana/kit');
    const bytes = Uint8Array.from(JSON.parse(readFileSync(solKeypairPath, 'utf8')));
    const kp = await createKeyPairSignerFromBytes(bytes);
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const svmScheme = new ExactSvmScheme(kp, { rpcUrl });
    const solClient = new x402Client().register('solana:*', svmScheme);
    rails.sol = {
      network: SOLANA_MAINNET_CAIP2,
      fetch: wrapFetchWithPayment(fetch, solClient),
      addr: kp.address,
    };
  } catch (e) { console.log(`[sol] skip: ${e.message}`); }
}

// Filter rails if RAILS env is set
const wantedRails = process.env.RAILS?.split(',').map(r => r.trim().toLowerCase());
if (wantedRails) {
  for (const k of Object.keys(rails)) {
    if (!wantedRails.includes(k)) delete rails[k];
  }
}

const railNames = Object.keys(rails);
if (railNames.length === 0) {
  console.error('No funded rails available. Set BASE_KEY, MEGA_KEY, or provide SOL_KEYPAIR.');
  process.exit(1);
}

console.log(`Rails: ${railNames.map(r => `${r} (${rails[r].addr})`).join(', ')}\n`);

// ── Discovery ───────────────────────────────────────────────────────

const dRes = await fetch(DISCOVERY, { signal: AbortSignal.timeout(10000) });
if (!dRes.ok) { console.error(`Discovery failed: ${dRes.status}`); process.exit(1); }
const discovery = await dRes.json();
const services = discovery.services.sort((a, b) => a.id.localeCompare(b.id));

console.log(`Discovered ${services.length} endpoints\n`);

// ── Build request from discovery params ─────────────────────────────

function buildRequest(svc) {
  const method = (svc.method || 'GET').toUpperCase();
  const u = new URL(svc.endpoint);

  // Query params from discovery
  for (const [k, spec] of Object.entries(svc.parameters?.query || {})) {
    const val = spec?.example ?? spec?.default;
    if (val !== undefined) u.searchParams.set(k, String(val));
    else if (spec?.required) u.searchParams.set(k, spec.type === 'number' ? '1' : 'test');
  }

  if (method === 'GET' || method === 'HEAD') {
    return { url: u.toString(), init: { method } };
  }

  // Body params from discovery
  const body = {};
  for (const [k, spec] of Object.entries(svc.parameters?.body || {})) {
    if (spec?.example !== undefined) body[k] = spec.example;
    else if (spec?.default !== undefined) body[k] = spec.default;
    else if (spec?.required) body[k] = spec.type === 'number' ? 1 : 'test';
  }

  // ipfs-pin special case: use json only
  if (svc.id === 'ipfs-pin') { delete body.url; delete body.name; if (!body.json) body.json = { test: true }; }

  return {
    url: u.toString(),
    init: { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  };
}

// ── Run sweep ───────────────────────────────────────────────────────

const totals = {};
for (const r of railNames) totals[r] = { ok: 0, degraded: 0, broken: 0, skipped: 0 };

for (const svc of services) {
  const { url, init } = buildRequest(svc);
  const line = [];

  for (const [railName, rail] of Object.entries(rails)) {
    try {
      const res = await rail.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = {}; }

      if (res.status === 200) {
        totals[railName].ok++;
        line.push(`${railName}:ok`);
      } else if (res.status === 503 && data.retryable) {
        totals[railName].degraded++;
        line.push(`${railName}:degraded`);
      } else if (res.status === 402) {
        totals[railName].broken++;
        line.push(`${railName}:402-payment-failed`);
      } else {
        totals[railName].broken++;
        line.push(`${railName}:${res.status}`);
      }
    } catch (e) {
      const kind = String(e.message).includes('timeout') ? 'timeout' : 'error';
      totals[railName].broken++;
      line.push(`${railName}:${kind}`);
    }
  }

  const allOk = line.every(l => l.endsWith(':ok'));
  const prefix = allOk ? '  ok' : line.some(l => l.includes('degraded')) ? '  !!' : '  XX';
  console.log(`${prefix}  ${svc.id.padEnd(24)} ${line.join('  ')}`);

  await new Promise(r => setTimeout(r, 200));
}

// ── Summary ─────────────────────────────────────────────────────────

console.log('\n--- Summary ---');
let totalBroken = 0;
for (const [r, t] of Object.entries(totals)) {
  console.log(`${r.padEnd(8)}: ${t.ok} ok, ${t.degraded} degraded, ${t.broken} broken, ${t.skipped} skipped`);
  totalBroken += t.broken;
}
console.log(`\nTotal endpoints: ${services.length}`);
process.exit(totalBroken > 0 ? 1 : 0);
