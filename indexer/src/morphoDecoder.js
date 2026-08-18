// Morpho Blue decoder - wallet and asset extraction logic
// The wallet field isn't in the same arg position across event types —
// normalize here so callers don't need per-event-type logic.
function extractWallet(eventName, args) {
  switch (eventName) {
    case "SupplyCollateral":
    case "Supply":
      return args.supplier;
    case "WithdrawCollateral":
    case "Withdraw":
      return args.owner;
    case "Borrow":
      return args.borrower;
    case "Repay":
      return args.caller;
    case "Liquidate":
      return args.caller;
    default:
      return null;
  }
}

function extractAssetAndAmount(eventName, args) {
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
      return { asset: args.id, amount: args.amount.toString() };
    default:
      return { asset: null, amount: null };
  }
}

module.exports = { extractWallet, extractAssetAndAmount };
