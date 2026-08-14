/**
 * getLatestAttested.js
 *
 * Simple script to get the latest attested block height for Ethereum Sepolia
 * using the proper SDK method.
 */

require("dotenv").config();
const { JsonRpcProvider } = require("ethers");
const { chainInfo } = require("@gluwa/usc-sdk");

async function main() {
  const { CC3_TESTNET_RPC } = process.env;

  if (!CC3_TESTNET_RPC) {
    throw new Error("Missing CC3_TESTNET_RPC in .env file");
  }

  console.log("Connecting to Creditcoin CC3 Testnet...");
  const creditcoinProvider = new JsonRpcProvider(CC3_TESTNET_RPC);

  console.log("Creating chain info provider...");
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);

  // Ethereum Sepolia has chainKey: 1
  const chainKey = 1;
  console.log(`Getting latest attested block for chainKey ${chainKey} (Ethereum Sepolia)...`);

  try {
    const latestAttested = await chainInfoProvider.getLatestAttestedHeightAndHash(chainKey);
    console.log("\n=== LATEST ATTESTED BLOCK INFO ===");
    console.log(`Block Height: ${latestAttested.height}`);
    console.log(`Block Hash: ${latestAttested.hash}`);
    console.log("\n=== SUMMARY ===");
    console.log(`✅ The latest attested block on Ethereum Sepolia is: ${latestAttested.height}`);
    console.log(`Any transaction in block ${latestAttested.height} or earlier should be ready for proof generation.`);
  } catch (error) {
    console.error("Error getting latest attested block:", error.message);
    console.log("\nThis might mean:");
    console.log("- The SDK method name has changed");
    console.log("- Creditcoin is not currently attesting Ethereum Sepolia blocks");
    console.log("- Network connectivity issues");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});