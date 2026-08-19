/**
 * Setup Compound pool address in CreditScoreMVP contract
 * This script calls setPoolAddress to register the Compound Comet address
 * for Sepolia so that Compound transactions can be proven.
 */

require("dotenv").config();
const { ethers } = require("ethers");

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const CONTRACT_ABI = [
  "function setPoolAddress(uint64 chainKey, uint8 protocolId, address pool) external",
  "function poolAddressByChainAndProtocol(uint64 chainKey, uint8 protocolId) external view returns (address)",
  "function owner() external view returns (address)"
];

async function main() {
  console.log("Setting up Compound pool address in CreditScoreMVP contract...");

  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet.connect(provider));

  // Check current owner
  const currentOwner = await contract.owner();
  console.log(`Contract owner: ${currentOwner}`);
  console.log(`Wallet address: ${wallet.address}`);

  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error("Error: You are not the contract owner!");
    process.exit(1);
  }

  // Parameters
  const chainKey = 11155111; // Sepolia
  const protocolId = 1;      // Compound
  const poolAddress = "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e"; // Compound Comet USDC

  console.log(`Setting pool address for chain ${chainKey}, protocol ${protocolId} to ${poolAddress}`);

  // Check current value
  const currentPool = await contract.poolAddressByChainAndProtocol(chainKey, protocolId);
  console.log(`Current pool address: ${currentPool}`);

  if (currentPool.toLowerCase() === poolAddress.toLowerCase()) {
    console.log("Pool address already set correctly!");
    return;
  }

  // Set the pool address
  const tx = await contract.setPoolAddress(chainKey, protocolId, poolAddress);
  console.log(`Transaction submitted: ${tx.hash}`);
  await tx.wait();
  console.log("✅ Pool address set successfully!");

  // Verify
  const newPool = await contract.poolAddressByChainAndProtocol(chainKey, protocolId);
  console.log(`New pool address: ${newPool}`);
}

main().catch(console.error);
