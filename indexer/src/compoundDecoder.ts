import type { Result } from "ethers";
import type { AssetAndAmount } from "./aaveDecoder";

// Compound Comet decoder - wallet and asset extraction logic
// For Compound Comet, event classification depends on asset type:
// - Supply of base asset = Repay
// - Supply of collateral asset = Supply
// - Withdraw of base asset = Borrow
// - Withdraw of collateral asset = Withdraw
// - Absorb = LiquidationCall

// This needs to be configured per-chain since base asset addresses differ
const COMET_BASE_ASSETS: Record<string, string> = {
  sepolia: "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e", // USDC on Sepolia Comet (actual base asset)
  // Add other chains as needed
};

export function getBaseAssetAddress(chain: string): string | null {
  return COMET_BASE_ASSETS[chain] || null;
}

export function setBaseAssetAddress(chain: string, address: string): void {
  COMET_BASE_ASSETS[chain] = address;
}

export function extractWallet(eventName: string, args: Result): string | null {
  switch (eventName) {
    case "Supply":
      return args.from as string;
    case "Withdraw":
      return args.to as string;
    case "Absorb":
      // Absorb has multiple accounts, use the absorber for now
      return args.absorber as string;
    default:
      return null;
  }
}

export function extractAssetAndAmount(eventName: string, args: Result, chain: string): AssetAndAmount {
  switch (eventName) {
    case "Supply":
    case "Withdraw":
      return { asset: args.asset as string, amount: (args.amount as bigint).toString() };
    case "Absorb":
      // Absorb doesn't have a single asset/amount - return null for now
      return { asset: null, amount: null };
    default:
      return { asset: null, amount: null };
  }
}

// Classify Compound event based on asset type
export function classifyCompoundEvent(eventName: string, assetAddress: string | null, chain: string): string {
  const baseAsset = getBaseAssetAddress(chain);
  if (!baseAsset || !assetAddress) {
    // If we don't know the base asset, use default classification
    return eventName;
  }

  const isBaseAsset = assetAddress.toLowerCase() === baseAsset.toLowerCase();

  if (eventName === "Supply") {
    return isBaseAsset ? "Repay" : "Supply";
  } else if (eventName === "Withdraw") {
    return isBaseAsset ? "Borrow" : "Withdraw";
  }

  return eventName;
}
