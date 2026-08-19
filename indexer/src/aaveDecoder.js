// The wallet field isn't in the same arg position across event types —
// normalize here so callers don't need per-event-type logic.
function extractWallet(eventName, args) {
  switch (eventName) {
    case "Supply":
    case "Borrow":
    case "DepositETH":
      return args.onBehalfOf;
    case "Repay":
    case "Withdraw":
    case "WithdrawETH":
    case "LiquidationCall":
      return args.user;
    default:
      return null;
  }
}

function extractAssetAndAmount(eventName, args) {
  switch (eventName) {
    case "Supply":
    case "Borrow":
    case "Withdraw":
    case "Repay":
      return { asset: args.reserve, amount: args.amount.toString() };
    case "LiquidationCall":
      return { asset: args.debtAsset, amount: args.debtToCover.toString() };
    case "DepositETH":
    case "WithdrawETH":
      return { asset: args.reserve, amount: args.amount.toString() };
    default:
      return { asset: null, amount: null };
  }
}

module.exports = { extractWallet, extractAssetAndAmount };
