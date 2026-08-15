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

  const { SEPOLIA_RPC, CONTRACT_ADDRESS } = process.env;
  
  if (!SEPOLIA_RPC) {
    console.error("Missing SEPOLIA_RPC in .env");
    process.exit(1);
  }

  if (!CONTRACT_ADDRESS) {
    console.error("Missing CONTRACT_ADDRESS in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ["function score(address) view returns (uint256)"],
    provider
  );

  try {
    const score = await contract.score(walletAddress);
    console.log(`Credit score for ${walletAddress}: ${score.toString()}`);
  } catch (error) {
    console.error("Error fetching score:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
