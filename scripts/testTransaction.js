/**
 * testTransaction.js
 *
 * Simple script to verify if a transaction exists on Ethereum Sepolia
 * and get its basic information without requiring the full setup.
 */

require("dotenv").config();
const { JsonRpcProvider } = require("ethers");

async function main() {
  const { SEPOLIA_RPC } = process.env;
  const txHash = process.argv[2] || process.env.SOURCE_TX_HASH;

  if (!SEPOLIA_RPC) {
    throw new Error("Missing SEPOLIA_RPC in .env file");
  }

  if (!txHash) {
    throw new Error("Please provide a transaction hash as argument or set SOURCE_TX_HASH in .env");
  }

  console.log("Testing transaction:", txHash);
  console.log("Connecting to Ethereum Sepolia...");
  
  const provider = new JsonRpcProvider(SEPOLIA_RPC);

  console.log("Fetching transaction...");
  const tx = await provider.getTransaction(txHash);

  if (!tx) {
    console.log("❌ Transaction NOT found on Ethereum Sepolia");
    console.log("This transaction hash either:");
    console.log("  - Doesn't exist");
    console.log("  - Is on a different chain (like Base Sepolia)");
    console.log("  - Is invalid");
    return;
  }

  console.log("✅ Transaction FOUND on Ethereum Sepolia!");
  console.log("\n=== TRANSACTION DETAILS ===");
  console.log("Hash:", tx.hash);
  console.log("From:", tx.from);
  console.log("To:", tx.to);
  console.log("Value:", tx.value.toString());
  console.log("Block Number:", tx.blockNumber);
  console.log("Block Hash:", tx.blockHash);
  console.log("Gas Limit:", tx.gasLimit.toString());
  console.log("Gas Price:", tx.gasPrice?.toString());
  console.log("Nonce:", tx.nonce);

  // Get block info
  if (tx.blockNumber) {
    const block = await provider.getBlock(tx.blockNumber);
    console.log("\n=== BLOCK DETAILS ===");
    console.log("Block Number:", block.number);
    console.log("Block Timestamp:", new Date(block.timestamp * 1000).toISOString());
    console.log("Block Hash:", block.hash);
  }

  console.log("\n✅ This transaction is valid and can be used with the Creditcoin Attestcoin Protocol!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});
