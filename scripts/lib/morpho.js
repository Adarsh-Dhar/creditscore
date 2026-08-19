/**
 * supply-to-morpho.js
 *
 * Script to perform a supply transaction to Morpho Blue on Sepolia.
 * Uses only verified addresses: Morpho Blue contract and IRM.
 *
 * Note: This script requires an existing market. Since we only have the Morpho Blue
 * contract and IRM addresses (no verified oracle or existing market parameters),
 * this script will attempt to supply but may fail if no suitable market exists.
 *
 * Usage: node scripts/lib/morpho.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const {
    SEPOLIA_RPC,
    PRIVATE_KEY,
    TARGET_WALLET,
    MORPHO_BLUE_SEPOLIA_ADDRESS,
    MORPHO_IRM,
  } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  if (!MORPHO_BLUE_SEPOLIA_ADDRESS) {
    console.error("Missing required environment variable:");
    console.error("  MORPHO_BLUE_SEPOLIA_ADDRESS");
    console.error("\nAdd it to your .env file with the Morpho Blue address on Sepolia.");
    process.exit(1);
  }

  // Morpho Blue singleton on Sepolia
  const MORPHO_ADDRESS = MORPHO_BLUE_SEPOLIA_ADDRESS;

  // WETH address on Sepolia
  const WETH_ADDRESS = "0xfff9976782d46cc05630d34fae175e5c0be1995d";

  console.log("Performing supply transaction to Morpho Blue on Sepolia...");
  console.log(`  Morpho Blue: ${MORPHO_ADDRESS}`);
  console.log(`  Asset: WETH`);
  console.log(`  Note: Using verified Morpho Blue address only. Market parameters not verified.`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);
  if (TARGET_WALLET) {
    console.log(`  Credit will go to: ${TARGET_WALLET}`);
  }

  console.log("\n⚠️  This script requires an existing Morpho Blue market with verified parameters.");
  console.log("Since we only have the Morpho Blue contract address (no verified oracle/market),");
  console.log("this script cannot reliably execute a supply transaction.");
  console.log("\nTo use Morpho, you need:");
  console.log("1. A verified oracle address for Sepolia");
  console.log("2. An existing market's full parameters (loanToken, collateralToken, oracle, irm, lltv)");
  console.log("\nScript exiting - no transaction executed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
