import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { ethers } from "ethers";

// Minimal ABI for CreditScoreMVP read functions
const ABI = [
  "function score(address wallet) view returns (uint256)",
  "function getStats(address wallet) view returns (uint64 supplyCount, uint64 borrowCount, uint64 repayCount, uint64 withdrawCount, uint64 liquidationCount)",
  "function SUPPLY_WEIGHT() view returns (int256)",
  "function BORROW_WEIGHT() view returns (int256)",
  "function REPAY_WEIGHT() view returns (int256)",
  "function WITHDRAW_WEIGHT() view returns (int256)",
  "function LIQUIDATION_WEIGHT() view returns (int256)",
];

export interface Stats {
  supplyCount: string;
  borrowCount: string;
  repayCount: string;
  withdrawCount: string;
  liquidationCount: string;
}

export interface Weights {
  supplyWeight: string;
  borrowWeight: string;
  repayWeight: string;
  withdrawWeight: string;
  liquidationWeight: string;
}

// Provider cache keyed by chain name
const providers: Record<string, ethers.JsonRpcProvider> = {};

let contract: ethers.Contract | undefined;

export function getProvider(chain = "cc3-testnet"): ethers.JsonRpcProvider {
  if (!providers[chain]) {
    // Try both underscore and hyphen formats for env var names
    const rpcEnvVar = `${chain.toUpperCase()}_RPC`;
    const rpcEnvVarAlt = `${chain.toUpperCase().replace("-", "_")}_RPC`;
    const rpcUrl = process.env[rpcEnvVar] || process.env[rpcEnvVarAlt];
    if (!rpcUrl) {
      throw new Error(`RPC URL not configured for ${chain}. Set ${rpcEnvVar} or ${rpcEnvVarAlt} in .env`);
    }
    providers[chain] = new ethers.JsonRpcProvider(rpcUrl);
  }
  return providers[chain];
}

function getContract(): ethers.Contract {
  if (!contract) {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("CONTRACT_ADDRESS not configured in .env");
    }
    // Contract lives on CC3 Testnet regardless of source chains
    contract = new ethers.Contract(contractAddress, ABI, getProvider("cc3-testnet"));
  }
  return contract;
}

export async function getScore(wallet: string): Promise<string> {
  const c = getContract();
  const score = await c.score(wallet);
  return score.toString();
}

export async function getStats(wallet: string): Promise<Stats> {
  const c = getContract();
  const stats = await c.getStats(wallet);
  return {
    supplyCount: stats.supplyCount.toString(),
    borrowCount: stats.borrowCount.toString(),
    repayCount: stats.repayCount.toString(),
    withdrawCount: stats.withdrawCount.toString(),
    liquidationCount: stats.liquidationCount.toString(),
  };
}

export async function getWeights(): Promise<Weights> {
  const c = getContract();
  const [supply, borrow, repay, withdraw, liquidation] = await Promise.all([
    c.SUPPLY_WEIGHT(),
    c.BORROW_WEIGHT(),
    c.REPAY_WEIGHT(),
    c.WITHDRAW_WEIGHT(),
    c.LIQUIDATION_WEIGHT(),
  ]);
  return {
    supplyWeight: supply.toString(),
    borrowWeight: borrow.toString(),
    repayWeight: repay.toString(),
    withdrawWeight: withdraw.toString(),
    liquidationWeight: liquidation.toString(),
  };
}

export async function getBlockNumber(chain = "cc3-testnet"): Promise<number> {
  const provider = getProvider(chain);
  return provider.getBlockNumber();
}
