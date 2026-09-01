"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBaseAssetAddress = getBaseAssetAddress;
exports.setBaseAssetAddress = setBaseAssetAddress;
exports.extractWallet = extractWallet;
exports.extractAssetAndAmount = extractAssetAndAmount;
exports.classifyCompoundEvent = classifyCompoundEvent;
// Compound Comet decoder - wallet and asset extraction logic
// For Compound Comet, event classification depends on asset type:
// - Supply of base asset = Repay
// - Supply of collateral asset = Supply
// - Withdraw of base asset = Borrow
// - Withdraw of collateral asset = Withdraw
// - Absorb = LiquidationCall
// This needs to be configured per-chain since base asset addresses differ
const COMET_BASE_ASSETS = {
    sepolia: "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e", // USDC on Sepolia Comet (actual base asset)
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
    if (!baseAsset || !assetAddress) {
        // If we don't know the base asset, use default classification
        return eventName;
    }
    const isBaseAsset = assetAddress.toLowerCase() === baseAsset.toLowerCase();
    if (eventName === "Supply") {
        return isBaseAsset ? "Repay" : "Supply";
    }
    else if (eventName === "Withdraw") {
        return isBaseAsset ? "Borrow" : "Withdraw";
    }
    return eventName;
}
//# sourceMappingURL=compoundDecoder.js.map