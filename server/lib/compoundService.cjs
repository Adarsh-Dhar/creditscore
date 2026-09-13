/**
 * compoundService.cjs
 *
 * Function-based Compound Comet module.
 *
 * Classification reminder (matches the indexer's compoundDecoder.ts):
 *   supply(USDC base asset)      → indexed as Repay
 *   supply(WETH collateral)      → indexed as Supply
 *   withdraw(USDC base asset)    → indexed as Borrow
 *   withdraw(WETH collateral)    → indexed as Withdraw
 *
 * Exposed operations:
 *   supplyBase   – supply USDC (base asset) → credit event: Repay
 *   supplyCollateral – supply WETH collateral → credit event: Supply
 *   withdrawBase – withdraw USDC (borrow)   → credit event: Borrow
 *   withdrawCollateral – withdraw WETH collateral → credit event: Withdraw
 */

"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

const COMET_ADDRESS = process.env.COMPOUND_SEPOLIA_COMET_USDC || "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e";
const BASE_ASSET_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"; // USDC on Sepolia
const KNOWN_WETH = "0xfff9976782d46cc05630d34fae175e5c0be1995d";

const COMET_ABI = [
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function userCollateral(address user, address asset) view returns (uint256 balance, uint256 reserves)",
  "function numAssets() view returns (uint8)",
  "function getAssetInfo(uint8 i) view returns (tuple(uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function balanceOf(address account) view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function mint(uint256 amount)",
  "function tap()",
];

function makeProvider() {
  const rpc = process.env.SEPOLIA_RPC;
  if (!rpc) throw new Error("SEPOLIA_RPC not set in environment");
  return new ethers.JsonRpcProvider(rpc);
}

function makeWallet(provider) {
  const key = process.env.PRIVATE_KEY;
  if (!key) throw new Error("PRIVATE_KEY not set in environment");
  return new ethers.Wallet(key, provider);
}

async function ensureAllowance(wallet, tokenAddress, amount) {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const current = await erc20.allowance(wallet.address, COMET_ADDRESS);
  if (current < BigInt(amount)) {
    const tx = await erc20.approve(COMET_ADDRESS, ethers.MaxUint256);
    await tx.wait();
  }
}

/** Try testnet faucet if balance is zero */
async function tryFaucet(wallet, tokenAddress) {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  for (const fn of ["tap", "mint"]) {
    try {
      const tx = fn === "tap"
        ? await erc20.tap()
        : await erc20["mint(uint256)"](ethers.parseUnits("10", 6));
      await tx.wait();
      return;
    } catch {
      // try next
    }
  }
}

/** Find the WETH collateral asset configured on this Comet market */
async function resolveCollateralAsset(provider) {
  const comet = new ethers.Contract(COMET_ADDRESS, COMET_ABI, provider);
  const numAssets = await comet.numAssets();
  for (let i = 0; i < numAssets; i++) {
    const info = await comet.getAssetInfo(i);
    if (info.asset.toLowerCase() === KNOWN_WETH.toLowerCase()) return info.asset;
  }
  // fallback: first configured collateral
  if (numAssets > 0) {
    const info = await comet.getAssetInfo(0);
    return info.asset;
  }
  throw new Error("No collateral assets configured on this Comet market");
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Supply USDC (base asset) → indexed as Repay.
 * @param {{ amount?: string }} params  amount in USDC smallest units (6 dec)
 */
async function supplyBase({ amount = "1000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);

  const erc20 = new ethers.Contract(BASE_ASSET_USDC, ERC20_ABI, wallet);
  let balance = await erc20.balanceOf(wallet.address);
  if (balance === 0n) {
    await tryFaucet(wallet, BASE_ASSET_USDC);
    balance = await erc20.balanceOf(wallet.address);
  }
  if (balance === 0n) throw new Error("No USDC balance — use the Sepolia USDC faucet");

  const supplyAmount = balance < BigInt(amount) ? balance : BigInt(amount);
  await ensureAllowance(wallet, BASE_ASSET_USDC, supplyAmount);

  const comet = new ethers.Contract(COMET_ADDRESS, COMET_ABI, wallet);
  const tx = await comet.supply(BASE_ASSET_USDC, supplyAmount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "supply-base", asset: "USDC", amount: supplyAmount.toString(), creditEvent: "Repay" };
}

/**
 * Supply WETH collateral → indexed as Supply.
 * @param {{ amount?: string }} params  amount in wei (18 dec)
 */
async function supplyCollateral({ amount = "1000000000000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const collateral = await resolveCollateralAsset(provider);

  const erc20 = new ethers.Contract(collateral, ERC20_ABI, wallet);
  const balance = await erc20.balanceOf(wallet.address);
  const supplyAmount = balance < BigInt(amount) ? balance : BigInt(amount);
  if (supplyAmount === 0n) throw new Error("No WETH collateral balance");

  await ensureAllowance(wallet, collateral, supplyAmount);

  const comet = new ethers.Contract(COMET_ADDRESS, COMET_ABI, wallet);
  const tx = await comet.supply(collateral, supplyAmount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "supply-collateral", asset: "WETH", amount: supplyAmount.toString(), creditEvent: "Supply" };
}

/**
 * Withdraw USDC (base asset, i.e. borrow) → indexed as Borrow.
 * @param {{ amount?: string }} params  amount in USDC smallest units (6 dec)
 */
async function withdrawBase({ amount = "1000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);

  const comet = new ethers.Contract(COMET_ADDRESS, COMET_ABI, wallet);
  const tx = await comet.withdraw(BASE_ASSET_USDC, amount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "withdraw-base", asset: "USDC", amount, creditEvent: "Borrow" };
}

/**
 * Withdraw WETH collateral → indexed as Withdraw.
 * @param {{ amount?: string }} params  amount in wei (18 dec)
 */
async function withdrawCollateral({ amount = "1000000000000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const collateral = await resolveCollateralAsset(provider);

  const comet = new ethers.Contract(COMET_ADDRESS, COMET_ABI, wallet);
  const [collateralBalance] = await comet.userCollateral(wallet.address, collateral);
  if (collateralBalance === 0n) throw new Error("No collateral balance to withdraw");

  const withdrawAmount = collateralBalance < BigInt(amount) ? collateralBalance : BigInt(amount);
  const tx = await comet.withdraw(collateral, withdrawAmount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "withdraw-collateral", asset: "WETH", amount: withdrawAmount.toString(), creditEvent: "Withdraw" };
}

module.exports = { supplyBase, supplyCollateral, withdrawBase, withdrawCollateral };
