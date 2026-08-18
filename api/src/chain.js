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

// Provider cache keyed by chain name
const providers = {};

let contract;

function getProvider(chain = 'cc3-testnet') {
  if (!providers[chain]) {
    const rpcEnvVar = `${chain.toUpperCase()}_RPC`;
    const rpcUrl = process.env[rpcEnvVar];
    if (!rpcUrl) {
      throw new Error(`RPC URL not configured for ${chain}. Set ${rpcEnvVar} in .env`);
    }
    providers[chain] = new ethers.JsonRpcProvider(rpcUrl);
  }
  return providers[chain];
}

function getContract() {
  if (!contract) {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error('CONTRACT_ADDRESS not configured in .env');
    }
    // Contract lives on CC3 Testnet regardless of source chains
    contract = new ethers.Contract(contractAddress, ABI, getProvider('cc3-testnet'));
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

async function getBlockNumber(chain = 'cc3-testnet') {
  const provider = getProvider(chain);
  return await provider.getBlockNumber();
}

module.exports = {
  getScore,
  getStats,
  getWeights,
  getBlockNumber,
  getProvider
};
