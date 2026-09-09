/**
 * Resolves an asset (by symbol) to a USD price, so Borrow/Repay amounts can
 * be summed into a single netOutstandingUSD figure across different assets
 * and chains — required by the continuous Utilization (U) factor in
 * scoreModel.ts, which decays/recovers based on outstanding USD debt.
 *
 * This is intentionally a minimal static/env-overridable price table, NOT
 * a live oracle integration (e.g. Chainlink). Wiring up a real price feed
 * is a separate piece of work — see the TODO below. Swapping it in later
 * only requires changing getPriceUSD()'s implementation; every caller
 * (store.ts) is unaffected.
 *
 * TODO(price-feed): replace with Chainlink price feeds (or another oracle)
 * per (chain, asset) once this indexer takes on that dependency. Until
 * then, prices below can be overridden per-symbol via env vars, e.g.:
 *   PRICE_USD_WETH=3200
 *   PRICE_USD_USDC=1
 */

// Reasonable static fallbacks for common testnet assets. Stablecoins are
// pegged at 1; volatile assets use a rough figure that can be overridden
// via PRICE_USD_<SYMBOL> env vars without a redeploy.
const DEFAULT_PRICES_USD: Record<string, number> = {
  USDC: 1,
  USDT: 1,
  DAI: 1,
  WETH: 3200,
  ETH: 3200,
  WBTC: 60000,
  BTC: 60000,
};

const FALLBACK_PRICE_USD = Number(process.env.PRICE_USD_UNKNOWN ?? 1);

const priceCache = new Map<string, number>();

/**
 * Returns a USD price for the given token symbol. Checks (in order):
 *   1. An env override: PRICE_USD_<SYMBOL_UPPERCASED>
 *   2. The static DEFAULT_PRICES_USD table
 *   3. FALLBACK_PRICE_USD (default 1), so scoring never throws on an
 *      unrecognized asset — it just treats it as ~$1 until a real price
 *      feed is wired up.
 *
 * `chain` and `asset` (address) are accepted for forward-compatibility
 * with a future per-chain/per-address oracle lookup (see TODO above) even
 * though the current implementation only keys off `symbol`.
 */
export function getPriceUSD(chain: string, asset: string, symbol: string): number {
  const key = symbol.toUpperCase();
  if (priceCache.has(key)) return priceCache.get(key)!;

  const envOverride = process.env[`PRICE_USD_${key}`];
  const price =
    envOverride !== undefined
      ? Number(envOverride)
      : DEFAULT_PRICES_USD[key] ?? FALLBACK_PRICE_USD;

  priceCache.set(key, price);
  return price;
}
