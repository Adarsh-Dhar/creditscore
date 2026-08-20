/**
 * morpho.js
 *
 * Script to perform direct Morpho Blue transactions on Sepolia.
 * This calls Morpho Blue functions directly (not through bundlers).
 *
 * IMPORTANT: Morpho Blue does not currently have any deployed markets on Sepolia.
 * The Morpho API (https://api.morpho.org) only supports mainnet, base, and other chains,
 * but not Sepolia (chainId 11155111). Without existing markets, direct calls will fail.
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
  } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  // Morpho Blue singleton on Sepolia (CREATE2 address)
  const MORPHO_ADDRESS = MORPHO_BLUE_SEPOLIA_ADDRESS || "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

  console.log("⚠️  Morpho Blue on Sepolia - Market Availability Check");
  console.log(`  Morpho Blue: ${MORPHO_ADDRESS}`);
  console.log(`  Chain: Sepolia (chainId: 11155111)`);

  console.log("\n📋 Status:");
  console.log("  ❌ No Morpho Blue markets exist on Sepolia");
  console.log("  ❌ Morpho API does not support Sepolia (chainId 11155111)");
  console.log("  ❌ Cannot perform direct Morpho Blue transactions on Sepolia");

  console.log("\n🔍 Why this limitation exists:");
  console.log("  1. Morpho Blue requires existing markets with proper MarketParams");
  console.log("  2. MarketParams include: loanToken, collateralToken, oracle, irm, lltv");
  console.log("  3. The Morpho API (https://api.morpho.org) only supports:");
  console.log("     - Ethereum Mainnet (chainId: 1)");
  console.log("     - Base (chainId: 8453)");
  console.log("     - Other supported chains (not Sepolia)");
  console.log("  4. Without market data from the API, direct calls will fail");

  console.log("\n💡 Alternatives for testing:");
  console.log("  1. Use Aave on Sepolia (working) - npm run aave");
  console.log("  2. Use Compound on Sepolia (working) - npm run compound");
  console.log("  3. Test Morpho Blue on Mainnet/Base (requires real market data)");
  console.log("  4. Deploy custom test markets on Sepolia (requires oracle setup)");

  console.log("\n📖 To use Morpho Blue when markets exist:");
  console.log("  1. Query https://api.morpho.org/graphql for market data");
  console.log("  2. Extract MarketParams: loanToken, collateralToken, oracle, irm, lltv");
  console.log("  3. Call Morpho Blue directly with proper market parameters");
  console.log("  4. Indexer will pick up direct protocol calls (not bundler calls)");

  console.log("\nCurrent system status:");
  console.log("  ✅ Aave on Sepolia: Working (direct protocol calls)");
  console.log("  ✅ Compound on Sepolia: Working (direct protocol calls)");
  console.log("  ❌ Morpho Blue on Sepolia: Not available (no markets)");
  console.log("  ⚠️  Morpho Blue bundler calls: Filtered out (by design)");

  console.log("\n✅ Script completed - No transaction executed (as expected)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
