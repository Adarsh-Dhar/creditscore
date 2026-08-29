import type { Result } from "ethers";

export interface AssetAndAmount {
  asset: string | null;
  amount: string | null;
}

// The wallet field isn't in the same arg position across event types —
// normalize here so callers don't need per-event-type logic.
export function extractWallet(eventName: string, args: Result): string | null {
  switch (eventName) {
    case "Supply":
    case "Borrow":
    case "DepositETH":
      return args.onBehalfOf as string;
    case "Repay":
    case "Withdraw":
    case "WithdrawETH":
    case "LiquidationCall":
      return args.user as string;
    default:
      return null;
  }
}

export function extractAssetAndAmount(eventName: string, args: Result): AssetAndAmount {
  switch (eventName) {
    case "Supply":
    case "Borrow":
    case "Withdraw":
    case "Repay":
      return { asset: args.reserve as string, amount: (args.amount as bigint).toString() };
    case "LiquidationCall":
      return { asset: args.debtAsset as string, amount: (args.debtToCover as bigint).toString() };
    case "DepositETH":
    case "WithdrawETH":
      return { asset: args.reserve as string, amount: (args.amount as bigint).toString() };
    default:
      return { asset: null, amount: null };
  }
}
