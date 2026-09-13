/**
 * liquityService.cjs
 *
 * Function-based Liquity V2 (BOLD) module.
 * All functions return { txHash, blockNumber, operation } on success, or throw.
 *
 * Trove ID note: Every operation except `open` requires a troveId.
 * Pass it explicitly in params, or set LIQUITY_TROVE_ID in .env.
 * After opening a trove the returned troveId is printed; set it in .env.
 */

"use strict";

require("dotenv").config();
const { ethers } = require("ethers");

const BORROWER_OPERATIONS = process.env.LIQUITY_SEPOLIA_BORROWER_OPERATIONS || "0x2377B5a07bdfA02812203BAB749E7bD43E4c596c";
const COLL_TOKEN = process.env.LIQUITY_SEPOLIA_COLL_TOKEN || "0x2442cA14d1217b4dD503e47DFdF79b774b56Ea89";

const BORROWER_OPS_ABI = [
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) external returns (uint256)",
  "function addColl(uint256 _troveId, uint256 _collAmount) external",
  "function withdrawColl(uint256 _troveId, uint256 _collWithdrawal) external",
  "function withdrawBold(uint256 _troveId, uint256 _boldAmount, uint256 _maxUpfrontFee) external",
  "function repayBold(uint256 _troveId, uint256 _boldAmount) external",
  "function closeTrove(uint256 _troveId) external",
];

const COLL_TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function deposit() payable",
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

function resolveTroveId(params) {
  const id = params?.troveId || process.env.LIQUITY_TROVE_ID;
  if (!id) throw new Error("troveId required — pass it in params or set LIQUITY_TROVE_ID in .env");
  return id;
}

async function ensureCollBalance(wallet, required) {
  const collToken = new ethers.Contract(COLL_TOKEN, COLL_TOKEN_ABI, wallet);
  const balance = await collToken.balanceOf(wallet.address);
  if (balance < BigInt(required)) {
    const shortfall = BigInt(required) - balance + ethers.parseEther("0.01");
    const depositTx = await collToken.deposit({ value: shortfall });
    await depositTx.wait();
  }
}

async function ensureAllowance(wallet, required) {
  const collToken = new ethers.Contract(COLL_TOKEN, COLL_TOKEN_ABI, wallet);
  const current = await collToken.allowance(wallet.address, BORROWER_OPERATIONS);
  if (current < BigInt(required)) {
    const tx = await collToken.approve(BORROWER_OPERATIONS, ethers.MaxUint256);
    await tx.wait();
  }
}

// ── Operations ───────────────────────────────────────────────────────────────

/**
 * Open a new Liquity V2 trove.
 * @param {{ collAmount?: string, boldAmount?: string }} params
 */
async function open({ collAmount = "2000000000000000000", boldAmount = "2200000000000000000000" } = {}) {
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  await ensureCollBalance(wallet, collAmount);
  const gasComp = ethers.parseUnits("0.0375", 18);
  await ensureAllowance(wallet, BigInt(collAmount) + gasComp);

  const tx = await borrowerOps.openTrove(
    wallet.address, 0,
    collAmount, boldAmount,
    0, 0,
    ethers.parseUnits("0.05", 18), // 5% annual rate
    ethers.MaxUint256,             // no fee cap
    ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress
  );
  const receipt = await tx.wait();

  // Compute deterministic trove ID: keccak256(abi.encode(owner, ownerIndex=0))
  const troveId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [wallet.address, 0])
  );

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "open", troveId };
}

/**
 * Add collateral to an existing trove.
 * @param {{ troveId?: string, collAmount?: string }} params
 */
async function addColl({ troveId, collAmount = "500000000000000000" } = {}) {
  const id = resolveTroveId({ troveId });
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  await ensureCollBalance(wallet, collAmount);
  await ensureAllowance(wallet, collAmount);

  const tx = await borrowerOps.addColl(id, collAmount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "add-coll", troveId: id };
}

/**
 * Withdraw collateral from a trove.
 * @param {{ troveId?: string, collAmount?: string }} params
 */
async function withdrawColl({ troveId, collAmount = "200000000000000000" } = {}) {
  const id = resolveTroveId({ troveId });
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  // Retry with progressively smaller amounts if near MCR
  const attempts = [BigInt(collAmount), BigInt(collAmount) / 2n, BigInt(collAmount) / 4n, BigInt(collAmount) / 10n];
  let lastErr;
  for (const amt of attempts) {
    if (amt === 0n) break;
    try {
      const tx = await borrowerOps.withdrawColl(id, amt);
      const receipt = await tx.wait();
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "withdraw-coll", troveId: id, amount: amt.toString() };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("withdrawColl failed — trove may be below MCR");
}

/**
 * Borrow more BOLD against an existing trove.
 * @param {{ troveId?: string, boldAmount?: string }} params
 */
async function withdrawBold({ troveId, boldAmount = "100000000000000000000" } = {}) {
  const id = resolveTroveId({ troveId });
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  const tx = await borrowerOps.withdrawBold(id, boldAmount, ethers.MaxUint256);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "withdraw-bold", troveId: id };
}

/**
 * Repay BOLD debt on a trove.
 * @param {{ troveId?: string, boldAmount?: string }} params
 */
async function repayBold({ troveId, boldAmount = "50000000000000000000" } = {}) {
  const id = resolveTroveId({ troveId });
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  const tx = await borrowerOps.repayBold(id, boldAmount);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "repay-bold", troveId: id };
}

/**
 * Close a trove (repays all debt, returns all collateral).
 * @param {{ troveId?: string }} params
 */
async function close({ troveId } = {}) {
  const id = resolveTroveId({ troveId });
  const provider = makeProvider();
  const wallet = makeWallet(provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPS_ABI, wallet);

  const tx = await borrowerOps.closeTrove(id);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, operation: "close", troveId: id };
}

module.exports = { open, addColl, withdrawColl, withdrawBold, repayBold, close };
