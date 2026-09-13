/**
 * aaveService.cjs
 *
 * Function-based Aave V3 module. All operations return
 * { txHash, blockNumber, operation, asset, amount } on success,
 * or throw an Error on failure. No process.exit, no console noise beyond
 * progress logs, no argv parsing.
 */

"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

// ── Contract addresses ──────────────────────────────────────────────────────
const DEFAULTS = {
  POOL: process.env.AAVE_SEPOLIA_POOL || "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
  WETHGATEWAY: process.env.AAVE_SEPOLIA_WETHGATEWAY || "0x387d311e47e80b498169e6fb51d3193167d89F7D",
  WETH: "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c",
  USDC: process.env.AAVE_SEPOLIA_USDC || "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8",
};

// ── Shared helpers ───────────────────────────────────────────────────────────
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

function makePool(wallet) {
  return new ethers.Contract(
    DEFAULTS.POOL,
    [
      "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
      "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
      "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)",
      "function withdraw(address asset, uint256 amount, address to)",
      "function getUserAccountData(address user) view returns (uint256, uint256, uint256, uint256, uint256, uint256)",
      "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
    ],
    wallet
  );
}

async function ensureAllowance(provider, wallet, tokenAddress, spender, amount) {
  const erc20 = new ethers.Contract(
    tokenAddress,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ],
    wallet
  );
  const current = await erc20.allowance(wallet.address, spender);
  if (current < BigInt(amount)) {
    const tx = await erc20.approve(spender, ethers.MaxUint256);
    await tx.wait();
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Supply WETH to Aave V3.
 * @param {{ amount?: string }} params
 */
async function supply({ amount = "1000000000000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const pool = makePool(wallet);

  const weth = new ethers.Contract(
    DEFAULTS.WETH,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const balance = await weth.balanceOf(wallet.address);
  const supplyAmount = balance < BigInt(amount) ? balance : BigInt(amount);
  if (supplyAmount === 0n) throw new Error("No WETH balance to supply");

  await ensureAllowance(provider, wallet, DEFAULTS.WETH, DEFAULTS.POOL, supplyAmount);

  const tx = await pool.supply(DEFAULTS.WETH, supplyAmount, wallet.address, 0);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "supply", asset: "WETH", amount: supplyAmount.toString() };
}

/**
 * Borrow USDC from Aave V3 (variable rate).
 * @param {{ amount?: string }} params
 */
async function borrow({ amount = "1000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const pool = makePool(wallet);

  const [, , availableBorrows] = await pool.getUserAccountData(wallet.address);
  if (availableBorrows === 0n) throw new Error("No borrow capacity — supply collateral first");

  const tx = await pool.borrow(DEFAULTS.USDC, amount, 2, 0, wallet.address);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "borrow", asset: "USDC", amount };
}

/**
 * Repay USDC debt on Aave V3.
 * @param {{ amount?: string }} params
 */
async function repay({ amount = "1000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const pool = makePool(wallet);

  const reserveData = await pool.getReserveData(DEFAULTS.USDC);
  const debtToken = new ethers.Contract(
    reserveData.variableDebtTokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const debt = await debtToken.balanceOf(wallet.address);
  if (debt === 0n) throw new Error("No USDC debt to repay");

  const repayAmount = debt < BigInt(amount) ? debt : BigInt(amount);
  await ensureAllowance(provider, wallet, DEFAULTS.USDC, DEFAULTS.POOL, repayAmount);

  const tx = await pool.repay(DEFAULTS.USDC, repayAmount, 2, wallet.address);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "repay", asset: "USDC", amount: repayAmount.toString() };
}

/**
 * Withdraw WETH from Aave V3.
 * @param {{ amount?: string }} params  pass "max" to withdraw everything
 */
async function withdraw({ amount = "1000000000000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const pool = makePool(wallet);

  const reserveData = await pool.getReserveData(DEFAULTS.WETH);
  const aToken = new ethers.Contract(
    reserveData.aTokenAddress,
    ["function balanceOf(address) view returns (uint256)"],
    provider
  );
  const aBalance = await aToken.balanceOf(wallet.address);
  if (aBalance === 0n) throw new Error("No WETH aToken balance to withdraw");

  const withdrawAmount = amount === "max" ? ethers.MaxUint256 : BigInt(amount);

  const tx = await pool.withdraw(DEFAULTS.WETH, withdrawAmount, wallet.address);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "withdraw", asset: "WETH", amount: withdrawAmount.toString() };
}

/**
 * Add collateral (alias for supply).
 */
async function addCollateral(params) {
  const result = await supply(params);
  return { ...result, operation: "add-collateral" };
}

/**
 * Remove collateral (alias for withdraw).
 */
async function removeCollateral(params) {
  const result = await withdraw(params);
  return { ...result, operation: "remove-collateral" };
}

module.exports = { supply, borrow, repay, withdraw, addCollateral, removeCollateral };
