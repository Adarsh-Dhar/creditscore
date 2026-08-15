/**
 * Check the credit score for a specific wallet address
 * Usage: node scripts/checkScore.js <wallet_address>
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const walletAddress = process.argv[2];
  
  if (!walletAddress) {
    console.error("Usage: node scripts/checkScore.js <wallet_address>");
    process.exit(1);
  }

  if (!ethers.isAddress(walletAddress)) {
    console.error("Invalid Ethereum address");
    process.exit(1);
  }

  const { CC3_TESTNET_RPC, CONTRACT_ADDRESS } = process.env;
  
  if (!CC3_TESTNET_RPC) {
    console.error("Missing CC3_TESTNET_RPC in .env");
    process.exit(1);
  }

  if (!CONTRACT_ADDRESS) {
    console.error("Missing CONTRACT_ADDRESS in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    [
      "function score(address) view returns (uint256)",
      "function getStats(address) view returns (uint64,uint64,uint64,uint64,uint64)",
    ],
    provider
  );

  try {
    const score = await contract.score(walletAddress);
    const [supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount] =
      await contract.getStats(walletAddress);

    console.log(`Credit score for ${walletAddress}: ${score.toString()}`);
    console.log("Breakdown:");
    console.log(`  Supply:      ${supplyCount} × 5   = ${supplyCount * 5n}`);
    console.log(`  Borrow:      ${borrowCount} × 2   = ${borrowCount * 2n}`);
    console.log(`  Repay:       ${repayCount} × 15  = ${repayCount * 15n}`);
    console.log(`  Withdraw:    ${withdrawCount} × 0   = 0`);
    console.log(`  Liquidation: ${liquidationCount} × -20 = ${liquidationCount * -20n}`);
  } catch (error) {
    console.error("Error fetching score:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
