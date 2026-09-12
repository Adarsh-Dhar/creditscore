import { Interface } from "ethers";
import type { AssetAndAmount } from "./aaveDecoder.js";

/**
 * Liquity V2 decoder — wallet and event-type extraction from the
 * transaction's own calldata + sender, NOT from event args.
 *
 * Why: Liquity's TroveManager emits TroveOperation/TroveUpdated events, but
 * (a) TroveManager is a *different* contract than the one users actually
 * call (BorrowerOperations), and (b) those events identify a trove by
 * troveId — a hash of owner+ownerIndex — not by the owner's address. So
 * there's no event-arg path to "which wallet did this" the way there is
 * for Aave/Compound/Morpho. Instead we mirror exactly what the on-chain
 * CreditScoreMVP contract does: decode the BorrowerOperations function
 * selector out of the transaction's calldata, and take the wallet from
 * the transaction's `from` address.
 *
 * Selectors below are keccak256(functionSignature)[:4] for Liquity V2's
 * BorrowerOperations, matching contracts/CreditScoreMVP.sol's constants
 * exactly — this file and the contract must not drift apart.
 */

// selector -> generic EventType name (must match GENERIC_EVENT_NAMES)
export const LIQUITY_SELECTORS: Record<string, string> = {
  "0x9cb90ba6": "Supply",   // openTrove(...)
  "0x59f54f40": "Supply",   // addColl(uint256,uint256)
  "0x580de360": "Withdraw", // withdrawColl(uint256,uint256)
  "0x90de348a": "Borrow",   // withdrawBold(uint256,uint256,uint256)
  "0x5cd067cf": "Repay",    // repayBold(uint256,uint256)
  "0x5aa6d461": "Withdraw", // closeTrove(uint256)
  // adjustTrove (0x84e5253c) is deliberately excluded: a single call can
  // move both collateral and debt in either direction, so the selector
  // alone can't tell us which EventType it was.
};

// Only the functions with a simple, confidently-known parameter list get
// full calldata decoding for the `amount` field. openTrove's full parameter
// list is more involved and decoding it wrong would silently produce a
// bogus amount, so it's decoded in a try/catch below and falls
// back to `null` rather than guessing. The ABI is verified against the
// official Liquity V2 (BOLD) repository at:
// https://github.com/liquity/bold/blob/a34960222df5061fa7c0213df5d20626adf3ecc4/contracts/src/BorrowerOperations.sol
const LIQUITY_FUNCTION_ABIS: Record<string, string> = {
  "0x59f54f40": "function addColl(uint256 _troveId, uint256 _collAmount)",
  "0x580de360": "function withdrawColl(uint256 _troveId, uint256 _collWithdrawal)",
  "0x90de348a": "function withdrawBold(uint256 _troveId, uint256 _boldAmount, uint256 _maxUpfrontFee)",
  "0x5cd067cf": "function repayBold(uint256 _troveId, uint256 _boldAmount)",
};

// ABI verified against official Liquity V2 (BOLD) repository. If decoding
// fails, we fall back to null rather than crediting a wrong amount.
const OPEN_TROVE_BEST_EFFORT_ABI =
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) external returns (uint256)";

export function decodeLiquitySelector(data: string | null | undefined): string | null {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  return LIQUITY_SELECTORS[selector] ?? null;
}

/**
 * Decode the collateral/debt amount out of the calldata for the function
 * types we're confident about. Returns null (not an error) for openTrove
 * if the best-effort ABI doesn't match, and for closeTrove (whose amount
 * is "all remaining collateral", not a calldata argument).
 */
export function decodeLiquityAmount(data: string | null | undefined): string | null {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();

  const fnAbi = LIQUITY_FUNCTION_ABIS[selector];
  if (fnAbi) {
    try {
      const iface = new Interface([fnAbi]);
      const fragment = iface.getFunction(iface.fragments[0].format());
      if (!fragment) return null;
      const decoded = iface.decodeFunctionData(fragment, data);
      // Every mapped signature's amount argument is the second positional
      // parameter (index 1): addColl/withdrawColl/withdrawBold/repayBold.
      const amount = decoded[1] as bigint;
      return amount.toString();
    } catch {
      return null;
    }
  }

  if (selector === "0x9cb90ba6") {
    try {
      const iface = new Interface([OPEN_TROVE_BEST_EFFORT_ABI]);
      const fragment = iface.getFunction(iface.fragments[0].format());
      if (!fragment) return null;
      const decoded = iface.decodeFunctionData(fragment, data);
      const collAmount = decoded[2] as bigint; // _collAmount
      return collAmount.toString();
    } catch {
      return null;
    }
  }

  // closeTrove: amount is "all remaining collateral", not a calldata value.
  return null;
}

/**
 * Given a protocol's classified generic event name, pick which token
 * address the `asset` field should record: collateral operations use the
 * branch collateral token, debt operations use BOLD.
 */
export function assetForLiquityEvent(
  eventName: string,
  collToken: string | null | undefined,
  boldToken: string | null | undefined
): string | null {
  switch (eventName) {
    case "Supply": // openTrove, addColl
      return collToken ?? null;
    case "Withdraw": // withdrawColl — closeTrove has no reliable single asset, see below
      return collToken ?? null;
    case "Borrow": // withdrawBold
    case "Repay": // repayBold
      return boldToken ?? null;
    default:
      return null;
  }
}

export interface LiquityDecodedFields {
  eventName: string | null;
  asset: string | null;
  amount: string | null;
}

/**
 * Full decode entrypoint: selector -> generic event name, asset, amount.
 * Wallet is NOT decoded here — callers already have it from tx.from.
 */
export function decodeLiquityTx(
  data: string | null | undefined,
  collToken: string | null | undefined,
  boldToken: string | null | undefined
): LiquityDecodedFields {
  const eventName = decodeLiquitySelector(data);
  if (!eventName) {
    return { eventName: null, asset: null, amount: null };
  }

  const selector = (data as string).slice(0, 10).toLowerCase();
  // closeTrove pays off all debt and returns all collateral — no single
  // calldata amount describes it, so leave asset/amount unset rather than
  // over-claiming precision we don't have.
  if (selector === "0x5aa6d461") {
    return { eventName, asset: null, amount: null };
  }

  return {
    eventName,
    asset: assetForLiquityEvent(eventName, collToken, boldToken),
    amount: decodeLiquityAmount(data),
  };
}
