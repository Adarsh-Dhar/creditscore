require('dotenv').config();
const { ethers } = require('ethers');

// Minimal ABI for CreditScoreMVP read functions
const ABI = [
  'function score(address wallet) view returns (uint256)',
  'function getStats(address wallet) view returns (uint64 supplyCount, uint64 borrowCount, uint64 repayCount, uint64 withdrawCount, uint64 liquidationCount)',
  'function SUPPLY_WEIGHT() view returns (int256)',
  'function BORROW_WEIGHT() view returns (int256)',
  'function REPAY_WEIGHT() view returns (int256)',
  'function WITHDRAW_WEIGHT() view returns (int256)',
  'function LIQUIDATION_WEIGHT() view returns (int256)'
];

let provider;
let contract;

function getProvider() {
  if (!provider) {
    const rpcUrl = process.env.CC3_TESTNET_RPC || process.env.SEPOLIA_RPC;
    if (!rpcUrl) {
      throw new Error('RPC URL not configured. Set CC3_TESTNET_RPC or SEPOLIA_RPC in .env');
    }
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

function getContract() {
  if (!contract) {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error('CONTRACT_ADDRESS not configured in .env');
    }
    contract = new ethers.Contract(contractAddress, ABI, getProvider());
  }
  return contract;
}

async function getScore(wallet) {
  const contract = getContract();
  const score = await contract.score(wallet);
  return score.toString();
}

async function getStats(wallet) {
  const contract = getContract();
  const stats = await contract.getStats(wallet);
  return {
    supplyCount: stats.supplyCount.toString(),
    borrowCount: stats.borrowCount.toString(),
    repayCount: stats.repayCount.toString(),
    withdrawCount: stats.withdrawCount.toString(),
    liquidationCount: stats.liquidationCount.toString()
  };
}

async function getWeights() {
  const contract = getContract();
  const [supply, borrow, repay, withdraw, liquidation] = await Promise.all([
    contract.SUPPLY_WEIGHT(),
    contract.BORROW_WEIGHT(),
    contract.REPAY_WEIGHT(),
    contract.WITHDRAW_WEIGHT(),
    contract.LIQUIDATION_WEIGHT()
  ]);
  return {
    supplyWeight: supply.toString(),
    borrowWeight: borrow.toString(),
    repayWeight: repay.toString(),
    withdrawWeight: withdraw.toString(),
    liquidationWeight: liquidation.toString()
  };
}

async function getBlockNumber() {
  // For MVP, we use a single RPC. In production, this would select
  // the appropriate RPC based on the chain parameter.
  const provider = getProvider();
  return await provider.getBlockNumber();
}

module.exports = {
  getScore,
  getStats,
  getWeights,
  getBlockNumber
};
