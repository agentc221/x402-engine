import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RoutesConfig } from "@x402/core/server";
import { config } from "../config.js";
import { MEGAETH_CONFIG, BASE_CONFIG, BASE_SEPOLIA_CONFIG } from "../config/chains.js";
import { priceStringToTokenAmount } from "../lib/validation.js";
import { buildBazaarExtensions } from "./bazaar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServiceUpstream {
  provider: string;
  baseUrl: string;
  keyParam?: string;
  keyHeader?: string;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  price: string;
  cost?: string;
  method: string;
  path: string;
  mimeType: string;
  category?: string;
  upstream: ServiceUpstream;
  parameters?: any;
}

interface ServicesFile {
  services: ServiceDefinition[];
}

const servicesPath = path.resolve(__dirname, "../../config/services.json");
const raw = readFileSync(servicesPath, "utf-8");
const { services } = JSON.parse(raw) as ServicesFile;

export function getAllServices(): ServiceDefinition[] {
  return services;
}

export function getService(id: string): ServiceDefinition | undefined {
  return services.find((s) => s.id === id);
}

// Networks we support
const NETWORKS = {
  base: "eip155:8453" as const,
  baseSepolia: "eip155:84532" as const,
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const,
  solanaDevnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const,
  megaeth: "eip155:4326" as const,
};

export function buildRoutesConfig(): RoutesConfig {
  const routes: Record<
    string,
    { accepts: any[]; description: string; mimeType: string; extensions: Record<string, unknown> }
  > = {};
  const isDev = config.isDev;

  for (const svc of services) {
    const routeKey = `${svc.method} ${svc.path}`;
    const accepts: any[] = [];

    // Base (or Base Sepolia in dev)
    if (config.payToEvm) {
      const evmNetwork = isDev ? NETWORKS.baseSepolia : NETWORKS.base;
      const baseChain = isDev ? BASE_SEPOLIA_CONFIG : BASE_CONFIG;
      const baseAmount = priceStringToTokenAmount(svc.price, baseChain.stablecoin.decimals).toString();

      accepts.push({
        scheme: "exact",
        price: svc.price,  // SDK server-side needs this for parsePrice()
        network: evmNetwork,
        asset: baseChain.stablecoin.address,
        amount: baseAmount,
        payTo: config.payToEvm,
        maxTimeoutSeconds: 300,
        extra: {
          name: "USD Coin",   // EIP-712 domain name (must match on-chain token name)
          version: "2",        // EIP-712 domain version
        },
      });

      // MegaETH — uses same EVM payTo address, custom facilitator handles it
      const megaAmount = priceStringToTokenAmount(svc.price, MEGAETH_CONFIG.stablecoin.decimals).toString();
      accepts.push({
        scheme: "exact",
        price: svc.price,  // SDK server-side needs this for parsePrice()
        network: NETWORKS.megaeth,
        asset: MEGAETH_CONFIG.stablecoin.address,
        amount: megaAmount,
        payTo: config.payToEvm,
        maxTimeoutSeconds: 300,
        extra: {
          name: "USDm",      // EIP-712 domain name (must match on-chain token name)
          version: "2",       // EIP-712 domain version
        },
      });
    }

    // Solana
    if (config.payToSolana) {
      const solNetwork = isDev ? NETWORKS.solanaDevnet : NETWORKS.solana;
      const solAmount = priceStringToTokenAmount(svc.price, 6).toString();  // USDC is 6 decimals
      // feePayer from CDP facilitator's getSupported() — used in discovery endpoint only.
      // The SDK middleware dynamically fetches the feePayer from the facilitator for 402 responses.
      const solFeePayer = isDev
        ? "BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP"   // devnet (CDP v2)
        : "GVJJ7rdGiXr5xaYbRwRbjfaJL7fmwRygFi1H6aGqDveb";  // mainnet (CDP v2)
      accepts.push({
        scheme: "exact",
        price: svc.price,  // SDK server-side needs this for parsePrice()
        network: solNetwork,
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  // Solana USDC mainnet
        amount: solAmount,
        payTo: config.payToSolana,
        maxTimeoutSeconds: 300,
        extra: {
          feePayer: solFeePayer,  // CDP facilitator's fee payer — required by ExactSvmScheme client
        },
      });
    }

    routes[routeKey] = {
      accepts,
      description: svc.description,
      mimeType: svc.mimeType,
      extensions: buildBazaarExtensions(svc),
    };
  }

  return routes as RoutesConfig;
}

export function getMegaEthInfo() {
  return {
    network: NETWORKS.megaeth,
    chainId: MEGAETH_CONFIG.chainId,
    rpc: MEGAETH_CONFIG.rpc,
    explorer: MEGAETH_CONFIG.explorer,
    stablecoin: MEGAETH_CONFIG.stablecoin,
    features: MEGAETH_CONFIG.features,
    status: "active",
  };
}

export { NETWORKS };
