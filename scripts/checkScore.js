/**
 * checkScore.js
 *
 * Reads a wallet's on-chain CreditScoreMVP score and per-event stats from
 * CC3 Testnet. Does not submit transactions.
 *
 * Usage:
 *   npm run check-score
 *   npm run check-score -- 0xYourWallet
 *
 * Requires in .env: CC3_TESTNET_RPC, CONTRACT_ADDRESS, and TARGET_WALLET
 * (TARGET_WALLET is optional if a wallet is passed as an argument).
 */

require("dotenv").config();
const { JsonRpcProvider, Contract, isAddress, getAddress } = require("ethers");

const ABI = [
  "function score(address) view returns (uint256)",
  "function getStats(address) view returns (uint64,uint64,uint64,uint64,uint64)",
  "function SUPPLY_WEIGHT() view returns (int256)",
  "function BORROW_WEIGHT() view returns (int256)",
  "function REPAY_WEIGHT() view returns (int256)",
  "function WITHDRAW_WEIGHT() view returns (int256)",
  "function LIQUIDATION_WEIGHT() view returns (int256)",
];

async function main() {
  const { CC3_TESTNET_RPC, CONTRACT_ADDRESS, TARGET_WALLET } = process.env;
  const walletArg = process.argv[2];
  const wallet = walletArg || TARGET_WALLET;

  if (!CC3_TESTNET_RPC) {
    throw new Error("Missing CC3_TESTNET_RPC in .env");
  }
  if (!CONTRACT_ADDRESS) {
    throw new Error("Missing CONTRACT_ADDRESS in .env — deploy first with `npm run deploy`");
  }
  if (!wallet) {
    throw new Error("Pass a wallet address or set TARGET_WALLET in .env");
  }
  if (!isAddress(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }
  if (!isAddress(CONTRACT_ADDRESS)) {
    throw new Error(`Invalid CONTRACT_ADDRESS: ${CONTRACT_ADDRESS}`);
  }

  const checksummedWallet = getAddress(wallet);
  const provider = new JsonRpcProvider(CC3_TESTNET_RPC);
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);

  const [score, stats, supplyW, borrowW, repayW, withdrawW, liquidationW, network] =
    await Promise.all([
      contract.score(checksummedWallet),
      contract.getStats(checksummedWallet),
      contract.SUPPLY_WEIGHT(),
      contract.BORROW_WEIGHT(),
      contract.REPAY_WEIGHT(),
      contract.WITHDRAW_WEIGHT(),
      contract.LIQUIDATION_WEIGHT(),
      provider.getNetwork(),
    ]);

  const [supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount] = stats;

  console.log("CreditScoreMVP");
  console.log(`  network:  chainId ${network.chainId}`);
  console.log(`  contract: ${CONTRACT_ADDRESS}`);
  console.log(`  wallet:   ${checksummedWallet}`);
  console.log("");
  console.log(`Score: ${score.toString()}`);
  console.log("");
  console.log("Stats (counts × weights):");
  console.log(`  Supply:      ${supplyCount} × ${supplyW}`);
  console.log(`  Borrow:      ${borrowCount} × ${borrowW}`);
  console.log(`  Repay:       ${repayCount} × ${repayW}`);
  console.log(`  Withdraw:    ${withdrawCount} × ${withdrawW}`);
  console.log(`  Liquidation: ${liquidationCount} × ${liquidationW}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
