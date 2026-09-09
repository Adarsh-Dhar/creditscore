/**
 * Resolves an ERC-20 token address to its symbol and decimals so that raw
 * uint256 amounts can be formatted as human-readable numbers before the AI
 * scorer ever sees them.
 *
 * Two-level cache (process-lifetime):
 *   providerCache — one JsonRpcProvider per chain name
 *   metaCache     — one { symbol, decimals } per "chain:address" key
 *
 * If the RPC env var is missing or the on-chain call fails (testnet tokens
 * that don't implement ERC-20 metadata cleanly), the function falls back to
 * { symbol: "UNKNOWN", decimals: 18 } so scoring still proceeds.
 */

import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { CHAINS } from "./config.js";

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const providerCache = new Map<string, JsonRpcProvider>();
const metaCache = new Map<string, { symbol: string; decimals: number }>();

function getProvider(chain: string): JsonRpcProvider | null {
  if (providerCache.has(chain)) return providerCache.get(chain)!;
  const chainConfig = CHAINS.find((c) => c.name === chain);
  const rpcUrl = chainConfig ? process.env[chainConfig.rpcEnvVar] : undefined;
  if (!rpcUrl) return null;
  const provider = new JsonRpcProvider(rpcUrl);
  providerCache.set(chain, provider);
  return provider;
}

export async function resolveTokenMeta(
  chain: string,
  asset: string,
): Promise<{ symbol: string; decimals: number }> {
  const key = `${chain}:${asset.toLowerCase()}`;
  if (metaCache.has(key)) return metaCache.get(key)!;

  const provider = getProvider(chain);
  let meta = { symbol: "UNKNOWN", decimals: 18 };

  if (provider) {
    try {
      const c = new Contract(asset, ERC20_ABI, provider);
      const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
      meta = { symbol: String(symbol), decimals: Number(decimals) };
    } catch {
      // Testnet token without clean symbol()/decimals() — keep the UNKNOWN fallback.
    }
  }

  metaCache.set(key, meta);
  return meta;
}

export function humanAmount(amount: string, decimals: number): string {
  return formatUnits(amount, decimals);
}
