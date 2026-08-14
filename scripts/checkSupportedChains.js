/**
 * checkSupportedChains.js
 *
 * Simple script to check which chains are supported by Creditcoin's Attestcoin Protocol.
 * This will tell us definitively if Base Sepolia is supported or not.
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

  console.log("Fetching supported chains from Creditcoin...");
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();

  console.log("\n=== SUPPORTED CHAINS ===");
  console.log(JSON.stringify(supportedChains, null, 2));
  console.log("\n=== END OF SUPPORTED CHAINS ===\n");

  // Check for Base Sepolia specifically
  console.log("Checking for Base Sepolia...");
  const baseSepoliaEntry = supportedChains.find((c) => 
    c.chainName?.toLowerCase().includes("base") && 
    c.chainName?.toLowerCase().includes("sepolia")
  );

  // Also check for any chain with chainId 84532 (Base Sepolia's chain ID)
  const baseSepoliaById = supportedChains.find((c) => 
    c.chainId === 84532
  );

  if (baseSepoliaEntry) {
    console.log("✅ FOUND Base Sepolia by name:", baseSepoliaEntry);
  } else {
    console.log("❌ Base Sepolia NOT found by name");
  }

  if (baseSepoliaById) {
    console.log("✅ FOUND chain with chainId 84532 (Base Sepolia):", baseSepoliaById);
  } else {
    console.log("❌ Chain with chainId 84532 (Base Sepolia) NOT found");
  }

  // Also check for regular Ethereum Sepolia for comparison
  const sepoliaEntry = supportedChains.find((c) =>
    c.chainName?.toLowerCase().includes("sepolia") && !c.chainName?.toLowerCase().includes("base")
  );
  
  if (sepoliaEntry) {
    console.log("\n✅ Found Ethereum Sepolia for comparison:", sepoliaEntry);
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  if (baseSepoliaEntry || baseSepoliaById) {
    console.log("✅ Base Sepolia IS supported by Creditcoin's Attestcoin Protocol");
  } else {
    console.log("❌ Base Sepolia is NOT supported by Creditcoin's Attestcoin Protocol");
    console.log("Only Ethereum Sepolia appears to be supported for transactions.");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exitCode = 1;
});
