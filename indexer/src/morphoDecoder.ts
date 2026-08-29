import type { Result } from "ethers";
import type { AssetAndAmount } from "./aaveDecoder";

// Morpho Blue decoder - wallet and asset extraction logic
// The wallet field isn't in the same arg position across event types —
// normalize here so callers don't need per-event-type logic.
export function extractWallet(eventName: string, args: Result): string | null {
  switch (eventName) {
    case "SupplyCollateral":
    case "Supply":
      return args.supplier as string;
    case "WithdrawCollateral":
    case "Withdraw":
      return args.owner as string;
    case "Borrow":
      return args.borrower as string;
    case "Repay":
      return args.caller as string;
    case "Liquidate":
      return args.caller as string;
    default:
      return null;
  }
}

export function extractAssetAndAmount(eventName: string, args: Result): AssetAndAmount {
  switch (eventName) {
    case "SupplyCollateral":
    case "Supply":
    case "WithdrawCollateral":
    case "Withdraw":
    case "Borrow":
    case "Repay":
    case "Liquidate":
      // Morpho Blue uses market IDs rather than individual asset addresses
      // Return the market ID and amount
      return { asset: args.id as string, amount: (args.amount as bigint).toString() };
    default:
      return { asset: null, amount: null };
  }
}
