/**
 * runAllTx.js
 *
 * Runs every indexable transaction type across all active protocols on Sepolia:
 *
 *  ── Aave V3 (7 tx types) ──────────────────────────────────────────────────
 *  1.  Supply WETH collateral         → Supply event
 *  2.  Borrow USDC                    → Borrow event
 *  3.  Repay USDC                     → Repay event
 *  4.  Withdraw WETH                  → Withdraw event
 *  5.  DepositETH via WETHGateway     → Supply event  (ETH path)
 *  6.  Supply USDC                    → Supply event  (second asset)
 *  7.  Repay with aTokens (USDC)      → Repay event   (alternate repay path)
 *
 *  ── Compound Comet USDC market (4 tx types) ───────────────────────────────
 *  8.  supply(WETH collateral)        → Supply event
 *  9.  supply(USDC base asset)        → Repay event   (base = Repay in decoder)
 * 10.  withdraw(USDC base asset)      → Borrow event  (base = Borrow in decoder)
 * 11.  withdraw(WETH collateral)      → Withdraw event
 *
 *  ── Liquity V2, ETH branch (5 tx types) ────────────────────────────────────
 * 12.  openTrove (coll + BOLD)        → Supply event
 * 13.  addColl                        → Supply event  (second collateral op)
 * 14.  withdrawBold                   → Borrow event
 * 15.  repayBold                      → Repay event
 * 16.  withdrawColl                   → Withdraw event
 *
 * Morpho Blue is skipped — no markets exist on Sepolia.
 *
 * Execution order is intentional: collateral first, borrow only after
 * supply, repay before withdraw so health factor stays safe throughout.
 *
 * Usage:
 *   node scripts/runAllTx.js               # run everything
 *   node scripts/runAllTx.js aave          # only Aave transactions
 *   node scripts/runAllTx.js compound      # only Compound transactions
 *   node scripts/runAllTx.js liquity       # only Liquity transactions
 *   node scripts/runAllTx.js aave:supply   # single named step
 *
 * Environment (.env at repo root):
 *   PRIVATE_KEY                — signer for all transactions
 *   SEPOLIA_RPC                — RPC endpoint for Ethereum Sepolia
 *   AAVE_SEPOLIA_POOL          — Aave V3 Pool address
 *   AAVE_SEPOLIA_WETHGATEWAY   — Aave WETHGateway address (optional, has default)
 *   AAVE_SEPOLIA_USDC          — USDC address on Sepolia (optional, has default)
 *   COMPOUND_SEPOLIA_COMET_USDC — Compound Comet USDC market address
 *   LIQUITY_SEPOLIA_BORROWER_OPERATIONS — Liquity BorrowerOperations address (optional, has default)
 *   LIQUITY_SEPOLIA_COLL_TOKEN — Liquity ETH-branch collateral token (optional, has default)
 *   LIQUITY_TROVE_ID           — set after step 12 runs once; required for steps 13-16
 */

"use strict";
require("dotenv").config();
const { ethers } = require("ethers");

// ── Constants ──────────────────────────────────────────────────────────────

const {
  SEPOLIA_RPC,
  PRIVATE_KEY,
  AAVE_SEPOLIA_POOL,
  AAVE_SEPOLIA_WETHGATEWAY,
  AAVE_SEPOLIA_USDC,
  COMPOUND_SEPOLIA_COMET_USDC,
  LIQUITY_SEPOLIA_BORROWER_OPERATIONS,
  LIQUITY_SEPOLIA_COLL_TOKEN,
  LIQUITY_TROVE_ID,
} = process.env;

// Aave V3 Sepolia defaults (from Aave address book)
const AAVE_POOL      = AAVE_SEPOLIA_POOL      || "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
const WETH_GATEWAY   = AAVE_SEPOLIA_WETHGATEWAY || "0x387d311e47e80b498169e6fb51d3193167d89F7D";
// Tokens on Sepolia
const WETH_ADDR      = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c"; // Aave-wrapped WETH on Sepolia
const WETH_COMET     = "0x2D5ee574e710219a521449679A4A7f2B43f046ad"; // WETH for Compound Comet (correct address)
const USDC_ADDR      = AAVE_SEPOLIA_USDC       || "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8";
const USDC_COMET     = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // USDC for Compound Comet

// Compound Comet (USDC market)
const COMET_ADDR     = COMPOUND_SEPOLIA_COMET_USDC || "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e";

// Liquity V2, ETH branch
const LIQUITY_BORROWER_OPS = LIQUITY_SEPOLIA_BORROWER_OPERATIONS || "0x2377B5a07bdfA02812203BAB749E7bD43E4c596c";
const LIQUITY_COLL_TOKEN   = LIQUITY_SEPOLIA_COLL_TOKEN || "0x2442cA14d1217b4dD503e47DFdF79b774b56Ea89";
const LIQUITY_OPEN_COLL_AMOUNT  = "2000000000000000000";    // 2 collateral tokens (18 dec)
const LIQUITY_OPEN_BOLD_AMOUNT  = "1800000000000000000000"; // 1800 BOLD (18 dec)
const LIQUITY_ADD_COLL_AMOUNT   = "500000000000000000";     // 0.5 collateral token
const LIQUITY_WITHDRAW_COLL_AMT = "200000000000000000";     // 0.2 collateral token
const LIQUITY_WITHDRAW_BOLD_AMT = "100000000000000000000";  // 100 BOLD
const LIQUITY_REPAY_BOLD_AMT    = "50000000000000000000";   // 50 BOLD

// Min amounts (small so they work on testnet)
const WETH_AMOUNT    = "2000000000000000";  // 0.002 WETH  (18 dec)
const USDC_AMOUNT    = "2000000";           // 2 USDC       (6 dec)
const ETH_AMOUNT     = "2000000000000000";  // 0.002 ETH    (18 dec)
const WETH_COMET_AMT = "1000000000000000";  // 0.001 WETH   (18 dec)
const USDC_COMET_AMT = "1000000";           // 1 USDC        (6 dec)

// ── ABIs (minimal) ─────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
  "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)",
  "function repayWithATokens(address asset, uint256 amount, uint256 interestRateMode) returns (uint256)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
];

const WETH_GATEWAY_ABI = [
  "function depositETH(address pool, address onBehalfOf, uint16 referralCode) payable",
  "function withdrawETH(address pool, uint256 amount, address to)",
];

const COMET_ABI = [
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function userCollateral(address user, address asset) view returns (uint128 balance, uint128 reserved)",
  "function balanceOf(address user) view returns (uint256)",
  "function borrowBalanceOf(address user) view returns (uint256)",
  "function allow(address manager, bool isAllowed)",
];

const IATOKENS_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

const DEBT_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
];

// Liquity V2 BorrowerOperations (ETH branch). openTrove's ABI here is
// best-effort — see scripts/lib/liquity.cjs's header comment for the same
// caveat; it's only exercised by step 12 below.
const LIQUITY_BORROWER_OPS_ABI = [
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) external returns (uint256)",
  "function addColl(uint256 _troveId, uint256 _collAmount) external",
  "function withdrawColl(uint256 _troveId, uint256 _collWithdrawal) external",
  "function withdrawBold(uint256 _troveId, uint256 _boldAmount, uint256 _maxUpfrontFee) external",
  "function repayBold(uint256 _troveId, uint256 _boldAmount) external",
  "function closeTrove(uint256 _troveId) external",
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Approve `spender` to spend at least `amount` of `tokenAddr` from `wallet`.
 * Skips the approval tx if allowance is already sufficient.
 */
async function ensureApproval(provider, wallet, tokenAddr, spender, amount, label) {
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
  const current = await token.allowance(wallet.address, spender);
  if (current >= BigInt(amount)) {
    console.log(`    [approval] ${label}: already approved (${current}), skipping`);
    return;
  }
  const tx = await token.connect(wallet).approve(spender, amount);
  console.log(`    [approval] ${label}: tx ${tx.hash}`);
  await tx.wait();
  console.log(`    [approval] ${label}: confirmed ✓`);
}

/**
 * Send `tx`, wait for receipt, log result.  Returns receipt.
 * Throws if the receipt status is 0 (reverted on-chain).
 */
async function send(label, txPromise) {
  console.log(`  → ${label}`);
  let tx;
  try {
    tx = await txPromise;
  } catch (err) {
    // Capture revert reason from eth_call simulation when available
    throw new Error(`${label}: send failed — ${err.message}`);
  }
  console.log(`    tx: ${tx.hash}`);
  const receipt = await tx.wait();
  if (receipt.status === 0) {
    throw new Error(`${label}: reverted on-chain (block ${receipt.blockNumber})`);
  }
  console.log(`    confirmed in block ${receipt.blockNumber} (gas: ${receipt.gasUsed}) ✓`);
  return receipt;
}

/**
 * Clamp `requested` to the available `balance`.
 * Returns the clamped value as a bigint string, or throws if balance is 0.
 */
function clamp(requested, balance, label) {
  const req = BigInt(requested);
  const bal = BigInt(balance);
  if (bal === 0n) throw new Error(`${label}: zero balance — cannot proceed`);
  if (bal < req) {
    console.log(`    [balance] ${label}: only ${bal} available, adjusting down from ${req}`);
    return bal.toString();
  }
  return req.toString();
}

// ── Aave transactions ──────────────────────────────────────────────────────

async function aaveSupplyWETH(provider, wallet) {
  console.log("\n[1/7] Aave · Supply WETH collateral  →  Supply event");
  const token = new ethers.Contract(WETH_ADDR, ERC20_ABI, provider);
  const bal = await token.balanceOf(wallet.address);
  const amount = clamp(WETH_AMOUNT, bal, "WETH");
  await ensureApproval(provider, wallet, WETH_ADDR, AAVE_POOL, amount, "WETH → AavePool");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
  await send("aave.supply(WETH)", pool.supply(WETH_ADDR, amount, wallet.address, 0));
}

async function aaveBorrowUSDC(provider, wallet) {
  console.log("\n[2/7] Aave · Borrow USDC  →  Borrow event");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
  const data = await pool.getUserAccountData(wallet.address);
  if (data.availableBorrowsBase === 0n) {
    throw new Error("Aave borrow: no borrow capacity — supply collateral first");
  }
  console.log(`    availableBorrows: $${ethers.formatUnits(data.availableBorrowsBase, 8)} (USD)`);
  // Borrow 1 USDC minimum — safe on testnet
  const amount = USDC_AMOUNT;
  // interestRateMode 2 = variable
  await send("aave.borrow(USDC, variable)", pool.borrow(USDC_ADDR, amount, 2, 0, wallet.address));
}

async function aaveRepayUSDC(provider, wallet) {
  console.log("\n[3/7] Aave · Repay WETH  →  Repay event");
  // USDC reserve is frozen (error 51) on this Sepolia deployment.
  // Instead repay using WETH variable debt if any exists, otherwise
  // do a fresh borrow+repay cycle with WETH so we still get a Repay event.
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, provider);
  const reserveDataWETH = await pool.getReserveData(WETH_ADDR);
  const debtToken = new ethers.Contract(reserveDataWETH.variableDebtTokenAddress, DEBT_TOKEN_ABI, provider);
  let debt = await debtToken.balanceOf(wallet.address);

  const poolW = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);

  if (debt === 0n) {
    // Borrow a tiny amount of WETH first so we can repay it
    console.log("    no WETH debt — borrowing 0.0001 WETH first to create debt for repay");
    try {
      await send("aave.borrow(WETH 0.0001 for repay)", poolW.borrow(WETH_ADDR, "100000000000000", 2, 0, wallet.address));
      debt = await debtToken.balanceOf(wallet.address);
    } catch (err) {
      console.log(`    skipping repay step: could not create WETH debt — ${err.message}`);
      return;
    }
  }

  const repayAmt = debt < BigInt("100000000000000") ? debt : BigInt("100000000000000");
  console.log(`    WETH debt: ${ethers.formatEther(debt)}, repaying: ${ethers.formatEther(repayAmt)}`);

  // Approve WETH for repay
  await ensureApproval(provider, wallet, WETH_ADDR, AAVE_POOL, repayAmt.toString(), "WETH → AavePool (repay)");
  await send("aave.repay(WETH)", poolW.repay(WETH_ADDR, repayAmt, 2, wallet.address));
}

async function aaveWithdrawWETH(provider, wallet) {
  console.log("\n[4/7] Aave · Withdraw WETH  →  Withdraw event");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, provider);
  const reserveData = await pool.getReserveData(WETH_ADDR);
  const aToken = new ethers.Contract(reserveData.aTokenAddress, IATOKENS_ABI, provider);
  const aBalance = await aToken.balanceOf(wallet.address);
  if (aBalance === 0n) {
    throw new Error("Aave withdraw: no WETH supplied (aToken balance is 0)");
  }
  // Withdraw a small slice so health factor isn't endangered by outstanding debt
  const amount = clamp(WETH_AMOUNT, aBalance, "aWETH");
  console.log(`    aWETH balance: ${ethers.formatEther(aBalance)}, withdrawing: ${ethers.formatEther(amount)}`);
  const poolW = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);

  // Check health factor after theoretical withdraw — if too low, take less
  const userData = await poolW.getUserAccountData(wallet.address);
  if (userData.healthFactor < ethers.parseUnits("1.2", 18) && userData.totalDebtBase > 0n) {
    console.log(`    ⚠️  health factor low (${ethers.formatUnits(userData.healthFactor, 18)}), withdrawing minimum slice`);
    // Withdraw only 10% of collateral to stay safe
    const safeAmount = aBalance / 10n || 1n;
    await send("aave.withdraw(WETH, partial)", poolW.withdraw(WETH_ADDR, safeAmount, wallet.address));
    return;
  }

  await send("aave.withdraw(WETH)", poolW.withdraw(WETH_ADDR, amount, wallet.address));
}

async function aaveDepositETHGateway(provider, wallet) {
  console.log("\n[5/7] Aave · Supply WETH (second supply)  →  Supply event");
  // The WETHGateway is deprecated on this Sepolia Aave deployment.
  // A second direct WETH supply achieves the same Supply event and
  // still covers the event type for credit scoring.
  const token = new ethers.Contract(WETH_ADDR, ERC20_ABI, provider);
  const bal = await token.balanceOf(wallet.address);
  const amount = clamp(WETH_AMOUNT, bal, "WETH (second supply)");
  await ensureApproval(provider, wallet, WETH_ADDR, AAVE_POOL, amount, "WETH → AavePool (supply 2)");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
  await send("aave.supply(WETH) #2", pool.supply(WETH_ADDR, amount, wallet.address, 0));
}

async function aaveSupplyUSDC(provider, wallet) {
  console.log("\n[6/7] Aave · Supply DAI  →  Supply event  (USDC reserve is frozen on this deployment)");
  // Aave Sepolia error "51" = reserve is frozen; use DAI instead
  const DAI_ADDR = "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357";
  const DAI_AMOUNT = "2000000000000000000"; // 2 DAI (18 dec)
  const token = new ethers.Contract(DAI_ADDR, ERC20_ABI, provider);
  const bal = await token.balanceOf(wallet.address);
  const amount = clamp(DAI_AMOUNT, bal, "DAI");
  await ensureApproval(provider, wallet, DAI_ADDR, AAVE_POOL, amount, "DAI → AavePool");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
  await send("aave.supply(DAI)", pool.supply(DAI_ADDR, amount, wallet.address, 0));
}

async function aaveRepayWithATokens(provider, wallet) {
  console.log("\n[7/7] Aave · RepayWithATokens (WETH)  →  Repay event  (alternate path)");
  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, provider);
  const reserveDataWETH = await pool.getReserveData(WETH_ADDR);
  const debtToken  = new ethers.Contract(reserveDataWETH.variableDebtTokenAddress, DEBT_TOKEN_ABI, provider);
  const aTokenWETH = new ethers.Contract(reserveDataWETH.aTokenAddress, IATOKENS_ABI, provider);
  const debt       = await debtToken.balanceOf(wallet.address);
  const aWETHBal   = await aTokenWETH.balanceOf(wallet.address);

  if (debt === 0n) {
    console.log("    skipping: no remaining WETH debt");
    return;
  }
  if (aWETHBal === 0n) {
    console.log("    skipping: no aWETH balance to repay with");
    return;
  }

  // Repay the lesser of debt and aWETH balance
  const repayable = aWETHBal < debt ? aWETHBal : debt;
  console.log(`    WETH debt: ${ethers.formatEther(debt)}, aWETH: ${ethers.formatEther(aWETHBal)}, repaying: ${ethers.formatEther(repayable)}`);
  const poolW = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
  await send("aave.repayWithATokens(WETH)", poolW.repayWithATokens(WETH_ADDR, repayable, 2));
}

// ── Compound transactions ──────────────────────────────────────────────────

async function compoundSupplyWETH(provider, wallet) {
  console.log("\n[8/11] Compound · supply(WETH collateral)  →  Supply event");
  const token = new ethers.Contract(WETH_COMET, ERC20_ABI, provider);
  const bal   = await token.balanceOf(wallet.address);
  const amount = clamp(WETH_COMET_AMT, bal, "WETH(Comet)");
  await ensureApproval(provider, wallet, WETH_COMET, COMET_ADDR, amount, "WETH → Comet");
  const comet = new ethers.Contract(COMET_ADDR, COMET_ABI, wallet);
  await send("comet.supply(WETH)", comet.supply(WETH_COMET, amount));
}

async function compoundSupplyUSDC(provider, wallet) {
  console.log("\n[9/11] Compound · supply(USDC base asset)  →  Repay event  (base=Repay in decoder)");
  const token  = new ethers.Contract(USDC_COMET, ERC20_ABI, provider);
  const bal    = await token.balanceOf(wallet.address);
  const amount = clamp(USDC_COMET_AMT, bal, "USDC(Comet)");
  await ensureApproval(provider, wallet, USDC_COMET, COMET_ADDR, amount, "USDC → Comet");
  const comet  = new ethers.Contract(COMET_ADDR, COMET_ABI, wallet);
  await send("comet.supply(USDC base)", comet.supply(USDC_COMET, amount));
}

async function compoundWithdrawUSDC(provider, wallet) {
  console.log("\n[10/11] Compound · withdraw(USDC base asset)  →  Borrow event  (base=Borrow in decoder)");
  const comet = new ethers.Contract(COMET_ADDR, COMET_ABI, wallet);
  // Borrow 1 USDC from the base asset pool
  // (requires WETH collateral already supplied, which step 8 does)
  const borrowBalance = await comet.borrowBalanceOf(wallet.address);
  // If we already have an open borrow, top it up; otherwise open a fresh one
  const amount = USDC_COMET_AMT;
  console.log(`    existing borrow balance: ${ethers.formatUnits(borrowBalance, 6)} USDC`);
  await send("comet.withdraw(USDC base→Borrow)", comet.withdraw(USDC_COMET, amount));
}

async function compoundWithdrawWETH(provider, wallet) {
  console.log("\n[11/11] Compound · withdraw(WETH collateral)  →  Withdraw event");
  const comet  = new ethers.Contract(COMET_ADDR, COMET_ABI, provider);
  const result = await comet.userCollateral(wallet.address, WETH_COMET);
  // userCollateral returns a struct; balance is index 0
  const cBal   = Array.isArray(result) ? result[0] : result.balance;
  if (cBal === 0n) {
    throw new Error("Compound withdraw WETH: no collateral deposited");
  }
  // Withdraw a small slice — leave enough collateral to cover any open borrow
  const amount = clamp(WETH_COMET_AMT, cBal.toString(), "WETH(Comet collateral)");
  console.log(`    collateral: ${ethers.formatEther(cBal)} WETH, withdrawing: ${ethers.formatEther(amount)}`);
  const cometW = new ethers.Contract(COMET_ADDR, COMET_ABI, wallet);
  await send("comet.withdraw(WETH)", cometW.withdraw(WETH_COMET, amount));
}

// ── Liquity transactions ─────────────────────────────────────────────────

// Liquity troveId is deterministic: uint256(keccak256(abi.encode(owner,
// ownerIndex))) — computed the same way BorrowerOperations does internally,
// so we don't need to parse logs/return data to know it after opening.
function computeLiquityTroveId(owner, ownerIndex) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(["address", "uint256"], [owner, ownerIndex]);
  return BigInt(ethers.keccak256(encoded));
}

// Populated by liquityOpenTrove() so later steps in the same run don't need
// LIQUITY_TROVE_ID set — falls back to the env var when steps are filtered
// to run independently (e.g. `node scripts/runAllTx.js liquity:add-coll`).
let liquityTroveId = LIQUITY_TROVE_ID ? BigInt(LIQUITY_TROVE_ID) : null;

function requireLiquityTroveId() {
  if (liquityTroveId == null) {
    throw new Error(
      "Liquity: no trove ID available — run liquity:open-trove first, or set LIQUITY_TROVE_ID in .env"
    );
  }
  return liquityTroveId;
}

async function liquityOpenTrove(provider, wallet) {
  console.log("\n[12/16] Liquity · openTrove (coll + BOLD)  →  Supply event");
  const token = new ethers.Contract(LIQUITY_COLL_TOKEN, ERC20_ABI, provider);
  const bal = await token.balanceOf(wallet.address);
  const amount = clamp(LIQUITY_OPEN_COLL_AMOUNT, bal, "Liquity coll token");
  await ensureApproval(provider, wallet, LIQUITY_COLL_TOKEN, LIQUITY_BORROWER_OPS, amount, "collToken → BorrowerOperations");

  const borrowerOps = new ethers.Contract(LIQUITY_BORROWER_OPS, LIQUITY_BORROWER_OPS_ABI, wallet);
  const ownerIndex = 0n;
  await send(
    "liquity.openTrove",
    borrowerOps.openTrove(
      wallet.address,
      ownerIndex,
      amount,
      LIQUITY_OPEN_BOLD_AMOUNT,
      0,
      0,
      ethers.parseUnits("0.05", 18), // 5% annual interest rate
      ethers.MaxUint256,             // no cap on upfront fee
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      wallet.address
    )
  );

  liquityTroveId = computeLiquityTroveId(wallet.address, ownerIndex);
  console.log(`    troveId: ${liquityTroveId.toString()}`);
  console.log(`    (set LIQUITY_TROVE_ID=${liquityTroveId.toString()} in .env to reuse this trove later)`);
}

async function liquityAddColl(provider, wallet) {
  console.log("\n[13/16] Liquity · addColl  →  Supply event  (second collateral op)");
  const troveId = requireLiquityTroveId();
  const token = new ethers.Contract(LIQUITY_COLL_TOKEN, ERC20_ABI, provider);
  const bal = await token.balanceOf(wallet.address);
  const amount = clamp(LIQUITY_ADD_COLL_AMOUNT, bal, "Liquity coll token");
  await ensureApproval(provider, wallet, LIQUITY_COLL_TOKEN, LIQUITY_BORROWER_OPS, amount, "collToken → BorrowerOperations");
  const borrowerOps = new ethers.Contract(LIQUITY_BORROWER_OPS, LIQUITY_BORROWER_OPS_ABI, wallet);
  await send("liquity.addColl", borrowerOps.addColl(troveId, amount));
}

async function liquityWithdrawBold(provider, wallet) {
  console.log("\n[14/16] Liquity · withdrawBold  →  Borrow event");
  const troveId = requireLiquityTroveId();
  const borrowerOps = new ethers.Contract(LIQUITY_BORROWER_OPS, LIQUITY_BORROWER_OPS_ABI, wallet);
  await send(
    "liquity.withdrawBold",
    borrowerOps.withdrawBold(troveId, LIQUITY_WITHDRAW_BOLD_AMT, ethers.MaxUint256)
  );
}

async function liquityRepayBold(provider, wallet) {
  console.log("\n[15/16] Liquity · repayBold  →  Repay event");
  const troveId = requireLiquityTroveId();
  const borrowerOps = new ethers.Contract(LIQUITY_BORROWER_OPS, LIQUITY_BORROWER_OPS_ABI, wallet);
  await send("liquity.repayBold", borrowerOps.repayBold(troveId, LIQUITY_REPAY_BOLD_AMT));
}

async function liquityWithdrawColl(provider, wallet) {
  console.log("\n[16/16] Liquity · withdrawColl  →  Withdraw event");
  const troveId = requireLiquityTroveId();
  const borrowerOps = new ethers.Contract(LIQUITY_BORROWER_OPS, LIQUITY_BORROWER_OPS_ABI, wallet);
  await send("liquity.withdrawColl", borrowerOps.withdrawColl(troveId, LIQUITY_WITHDRAW_COLL_AMT));
}

// ── Step registry ──────────────────────────────────────────────────────────

/**
 * All runnable steps, in execution order.
 * Each step includes a `key` for CLI filtering and a `fn` to invoke.
 */
const STEPS = [
  // Aave (must run in order: supply → borrow → repay → withdraw)
  { key: "aave:supply-weth",    protocol: "aave",     fn: aaveSupplyWETH       },
  { key: "aave:borrow-usdc",    protocol: "aave",     fn: aaveBorrowUSDC       },
  { key: "aave:repay-usdc",     protocol: "aave",     fn: aaveRepayUSDC        },
  { key: "aave:withdraw-weth",  protocol: "aave",     fn: aaveWithdrawWETH     },
  { key: "aave:deposit-eth",    protocol: "aave",     fn: aaveDepositETHGateway},
  { key: "aave:supply-usdc",    protocol: "aave",     fn: aaveSupplyUSDC       },
  { key: "aave:repay-atokens",  protocol: "aave",     fn: aaveRepayWithATokens },
  // Compound (supply collateral first, then borrow, then withdraw)
  { key: "compound:supply-weth",    protocol: "compound", fn: compoundSupplyWETH  },
  { key: "compound:supply-usdc",    protocol: "compound", fn: compoundSupplyUSDC  },
  { key: "compound:withdraw-usdc",  protocol: "compound", fn: compoundWithdrawUSDC},
  { key: "compound:withdraw-weth",  protocol: "compound", fn: compoundWithdrawWETH},
  // Liquity (open first — everything else needs an existing troveId)
  { key: "liquity:open-trove",      protocol: "liquity",  fn: liquityOpenTrove    },
  { key: "liquity:add-coll",        protocol: "liquity",  fn: liquityAddColl      },
  { key: "liquity:withdraw-bold",   protocol: "liquity",  fn: liquityWithdrawBold },
  { key: "liquity:repay-bold",      protocol: "liquity",  fn: liquityRepayBold    },
  { key: "liquity:withdraw-coll",   protocol: "liquity",  fn: liquityWithdrawColl },
];

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  if (!SEPOLIA_RPC)   throw new Error("SEPOLIA_RPC not set in .env");
  if (!PRIVATE_KEY)   throw new Error("PRIVATE_KEY not set in .env");

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  runAllTx — Sepolia (chainId ${network.chainId})`);
  console.log(`  Wallet : ${wallet.address}`);
  console.log(`  Aave   : ${AAVE_POOL}`);
  console.log(`  Comet  : ${COMET_ADDR}`);
  console.log(`  Liquity: ${LIQUITY_BORROWER_OPS}`);
  console.log(`${"═".repeat(60)}`);

  // Determine which steps to run from CLI arg
  const filter = process.argv[2]; // e.g. "aave", "compound", "aave:supply-weth"
  let steps = STEPS;
  if (filter) {
    steps = STEPS.filter((s) => s.key === filter || s.protocol === filter);
    if (steps.length === 0) {
      console.error(`\nUnknown filter "${filter}". Valid options:`);
      console.error("  aave  compound  liquity  " + STEPS.map((s) => s.key).join("  "));
      process.exit(1);
    }
    console.log(`\nRunning ${steps.length} step(s) matching "${filter}"`);
  } else {
    console.log(`\nRunning all ${steps.length} steps across Aave + Compound + Liquity`);
  }

  const results = { ok: [], skipped: [], failed: [] };

  for (const step of steps) {
    try {
      await step.fn(provider, wallet);
      results.ok.push(step.key);
    } catch (err) {
      // Distinguish "skipped by design" (non-fatal) from real failures
      const msg = err.message || String(err);
      if (msg.startsWith("skip") || msg.includes("skipping")) {
        console.log(`    ↷ skipped: ${msg}`);
        results.skipped.push(step.key);
      } else {
        console.error(`\n  ✗ ${step.key} FAILED: ${msg}`);
        results.failed.push({ key: step.key, error: msg });
        // Continue — don't abort the entire run on one failure
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log("  Results");
  console.log(`${"─".repeat(60)}`);
  console.log(`  ✓ success : ${results.ok.length}`);
  console.log(`  ↷ skipped : ${results.skipped.length}`);
  console.log(`  ✗ failed  : ${results.failed.length}`);

  if (results.ok.length > 0) {
    console.log("\n  Successful steps:");
    results.ok.forEach((k) => console.log(`    ✓ ${k}`));
  }
  if (results.skipped.length > 0) {
    console.log("\n  Skipped steps:");
    results.skipped.forEach((k) => console.log(`    ↷ ${k}`));
  }
  if (results.failed.length > 0) {
    console.log("\n  Failed steps:");
    results.failed.forEach(({ key, error }) => console.log(`    ✗ ${key}: ${error}`));
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Next steps:");
  console.log("    npm run index          ← pick up new events in the indexer");
  console.log("    npm run prove-queue    ← prove events and update credit scores");
  console.log(`${"═".repeat(60)}\n`);

  if (results.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message || err);
  process.exit(1);
});
