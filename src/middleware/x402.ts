import type { Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { paymentMiddlewareFromHTTPServer, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient, x402HTTPResourceServer } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { config } from "../config.js";
import { buildRoutesConfig, NETWORKS } from "../services/registry.js";
import { MegaETHFacilitatorClient } from "../facilitator/index.js";
import { MEGAETH_CONFIG } from "../config/chains.js";
import { priceStringToTokenAmount } from "../lib/validation.js";

/**
 * Converts a decimal USD amount to USDm token units (18 decimals).
 * Rounds to 6 decimal places first to eliminate IEEE 754 float noise.
 * e.g. 0.03 in float is 0.02999999999999999889 — rounding to 6 dp gives "0.030000"
 * which then converts cleanly to 30000000000000000 via string arithmetic.
 */
function usdToUsdm(amount: number): string {
  // Round to 6 dp to kill float noise (our prices have at most 3 dp)
  const rounded = Math.round(amount * 1e6) / 1e6;
  const str = rounded.toFixed(6);
  return priceStringToTokenAmount(str, MEGAETH_CONFIG.stablecoin.decimals).toString();
}

export function createPaymentMiddleware(): RequestHandler {
  const useCdp = !!(config.cdpApiKeyId && config.cdpApiKeySecret);
  const facilitatorConfig = useCdp
    ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
    : { url: config.facilitatorUrl || "https://x402.org/facilitator" };
  console.log(`  Facilitator: ${useCdp ? "Coinbase CDP" : facilitatorConfig.url}`);
  const officialFacilitator = new HTTPFacilitatorClient(facilitatorConfig);
  const megaethFacilitator = new MegaETHFacilitatorClient();

  const server = new x402ResourceServer([officialFacilitator, megaethFacilitator]);
  server.registerExtension(bazaarResourceServerExtension);

  const evmNetwork = config.isDev ? NETWORKS.baseSepolia : NETWORKS.base;
  server.register(evmNetwork, new ExactEvmScheme());

  const megaethScheme = new ExactEvmScheme();
  megaethScheme.registerMoneyParser(async (amount: number, network: string) => {
    if (network !== NETWORKS.megaeth) return null;
    return {
      amount: usdToUsdm(amount),
      asset: MEGAETH_CONFIG.stablecoin.address,
      extra: {
        name: MEGAETH_CONFIG.stablecoin.symbol,
        version: "2",
      },
    };
  });
  server.register(NETWORKS.megaeth, megaethScheme);

  const solNetwork = config.isDev ? NETWORKS.solanaDevnet : NETWORKS.solana;
  server.register(solNetwork, new ExactSvmScheme());

  // Fix: CDP facilitator returns different feePayers for unpaid vs paid request paths,
  // causing deepEqual mismatch in findMatchingRequirements. Patch to match on core fields
  // (scheme, network, amount, asset, payTo) and use the client's accepted requirements
  // (which have the correct feePayer for the Solana transaction they built).
  const origFind = server.findMatchingRequirements.bind(server);
  server.findMatchingRequirements = (
    availableRequirements: any[],
    paymentPayload: any,
  ) => {
    const exact = origFind(availableRequirements, paymentPayload);
    if (exact) return exact;

    if (paymentPayload.x402Version === 2 && paymentPayload.accepted) {
      const { accepted } = paymentPayload;
      const match = availableRequirements.find(
        (req: any) =>
          req.scheme === accepted.scheme &&
          req.network === accepted.network &&
          req.amount === accepted.amount &&
          req.asset === accepted.asset &&
          req.payTo === accepted.payTo,
      );
      if (match) {
        console.log(
          `[x402] Lenient match for ${accepted.network} (feePayer mismatch: server=${match.extra?.feePayer?.slice(0, 8)} client=${accepted.extra?.feePayer?.slice(0, 8)})`,
        );
        // Return client's accepted — has the correct feePayer for the signed transaction
        return accepted;
      }
    }
    return undefined;
  };

  // Build routes config for SDK verification
  const routes = buildRoutesConfig();
  console.log("  Payment routes configured:", Object.keys(routes as Record<string, unknown>).join(", "));

  const httpServer = new x402HTTPResourceServer(server, routes);
  const originalProcessHTTPRequest = httpServer.processHTTPRequest.bind(httpServer);
  httpServer.processHTTPRequest = async (...args) => {
    const [context] = args;
    const result = await originalProcessHTTPRequest(...args);
    if (result.type === "payment-verified") {
      const req = (context.adapter as any).req;
      if (req) {
        req.x402Verified = true;
      }
    }
    return result;
  };

  return paymentMiddlewareFromHTTPServer(httpServer);
}

/**
 * Dev bypass middleware — only active in development mode.
 * Disabled entirely when NODE_ENV=production.
 */
export function devBypassMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // SECURITY: dev bypass is completely disabled in production
    const bypassHeader = req.headers["x-dev-bypass"] as string | undefined;
    if (
      config.isDev &&
      config.devBypassSecret &&
      bypassHeader &&
      bypassHeader.length === config.devBypassSecret.length &&
      crypto.timingSafeEqual(Buffer.from(bypassHeader), Buffer.from(config.devBypassSecret))
    ) {
      (req as any).devBypassed = true;
      (req as any).x402 = {
        payer: null,
        network: "dev-bypass",
        amount: null,
        method: "dev-bypass",
      };
    }
    next();
  };
}
