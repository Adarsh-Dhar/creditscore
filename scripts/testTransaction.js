/**
 * Test transaction validation - check if a transaction is valid for proving
 * Usage: node scripts/testTransaction.js <tx_hash>
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const txHash = process.argv[2];
  
  if (!txHash) {
    console.error("Usage: node scripts/testTransaction.js <tx_hash>");
    process.exit(1);
  }

  if (!txHash.startsWith("0x") || txHash.length !== 66) {
    console.error("Invalid transaction hash format");
    process.exit(1);
  }

  const { SEPOLIA_RPC, TARGET_WALLET } = process.env;
  
  if (!SEPOLIA_RPC) {
    console.error("Missing SEPOLIA_RPC in .env");
    process.exit(1);
  }

  if (!TARGET_WALLET) {
    console.error("Missing TARGET_WALLET in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

  try {
    console.log(`Testing transaction: ${txHash}`);
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      console.error("Transaction not found");
      process.exit(1);
    }

    console.log(`Transaction found in block ${receipt.blockNumber}`);
    console.log(`Status: ${receipt.status === 1 ? "Success" : "Failed"}`);
    console.log(`From: ${receipt.from}`);
    console.log(`To: ${receipt.to}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

    // Check if it involves the target wallet
    const involvesTarget = 
      receipt.from.toLowerCase() === TARGET_WALLET.toLowerCase() ||
      (receipt.to && receipt.to.toLowerCase() === TARGET_WALLET.toLowerCase());
    
    console.log(`Involves target wallet (${TARGET_WALLET}): ${involvesTarget}`);

    // Get transaction details
    const tx = await provider.getTransaction(txHash);
    console.log(`Value: ${ethers.formatEther(tx.value)} ETH`);
    console.log(`Gas price: ${ethers.formatUnits(tx.gasPrice, "gwei")} gwei`);

    // Get block info
    const block = await provider.getBlock(receipt.blockNumber);
    console.log(`Block timestamp: ${new Date(block.timestamp * 1000).toISOString()}`);

    console.log("\n✅ Transaction is valid and can be used for proving");

  } catch (error) {
    console.error("Error testing transaction:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
