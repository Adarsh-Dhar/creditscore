// Compound Comet decoder - wallet and asset extraction logic
// The wallet field isn't in the same arg position across event types —
// normalize here so callers don't need per-event-type logic.
function extractWallet(eventName, args) {
  switch (eventName) {
    case "Supply":
    case "SupplyCollateral":
    case "Withdraw":
    case "WithdrawCollateral":
    case "Borrow":
    case "Repay":
      return args.from;
    case "Absorb":
      // Absorb has multiple accounts, use the absorber for now
      return args.absorber;
    default:
      return null;
  }
}

function extractAssetAndAmount(eventName, args) {
  switch (eventName) {
    case "Supply":
    case "SupplyCollateral":
    case "Withdraw":
    case "WithdrawCollateral":
    case "Borrow":
    case "Repay":
      return { asset: args.asset, amount: args.amount.toString() };
    case "Absorb":
      // Absorb doesn't have a single asset/amount - return null for now
      return { asset: null, amount: null };
    default:
      return { asset: null, amount: null };
  }
}

module.exports = { extractWallet, extractAssetAndAmount };
