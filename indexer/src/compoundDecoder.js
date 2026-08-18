// Compound Comet decoder - wallet and asset extraction logic
// For Compound Comet, event classification depends on asset type:
// - Supply of base asset = Repay
// - Supply of collateral asset = Supply  
// - Withdraw of base asset = Borrow
// - Withdraw of collateral asset = Withdraw
// - Absorb = LiquidationCall

// This needs to be configured per-chain since base asset addresses differ
const COMET_BASE_ASSETS = {
  sepolia: "0x7b79995e5f793A07Bc00c21412e50Ecae498dF6F", // USDC on Sepolia Comet
  // Add other chains as needed
};

function getBaseAssetAddress(chain) {
  return COMET_BASE_ASSETS[chain] || null;
}

function setBaseAssetAddress(chain, address) {
  COMET_BASE_ASSETS[chain] = address;
}

function extractWallet(eventName, args) {
  switch (eventName) {
    case "Supply":
      return args.from;
    case "Withdraw":
      return args.to;
    case "Absorb":
      // Absorb has multiple accounts, use the absorber for now
      return args.absorber;
    default:
      return null;
  }
}

function extractAssetAndAmount(eventName, args, chain) {
  switch (eventName) {
    case "Supply":
    case "Withdraw":
      return { asset: args.asset, amount: args.amount.toString() };
    case "Absorb":
      // Absorb doesn't have a single asset/amount - return null for now
      return { asset: null, amount: null };
    default:
      return { asset: null, amount: null };
  }
}

// Classify Compound event based on asset type
function classifyCompoundEvent(eventName, assetAddress, chain) {
  const baseAsset = getBaseAssetAddress(chain);
  if (!baseAsset) {
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

module.exports = { 
  extractWallet, 
  extractAssetAndAmount, 
  classifyCompoundEvent,
  getBaseAssetAddress,
  setBaseAssetAddress
};
