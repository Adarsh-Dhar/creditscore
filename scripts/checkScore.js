require("dotenv").config();
const { JsonRpcProvider, Contract } = require("ethers");

const CONTRACT_ABI = [
  "function score(address wallet) external view returns (uint256)",
];

async function main() {
  const { CC3_TESTNET_RPC, CONTRACT_ADDRESS, TARGET_WALLET } = process.env;

  if (!CC3_TESTNET_RPC || !CONTRACT_ADDRESS || !TARGET_WALLET) {
    throw new Error("Missing required .env values — check .env.example.");
  }

  const provider = new JsonRpcProvider(CC3_TESTNET_RPC);
  const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

  const score = await contract.score(TARGET_WALLET);
  console.log(`Score for ${TARGET_WALLET}: ${score}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
