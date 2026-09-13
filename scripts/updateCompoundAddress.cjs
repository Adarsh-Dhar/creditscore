/**
 * updateCompoundAddress.cjs
 *
 * One-time script to update the Compound pool address registered in the
 * deployed CreditScoreMVP contract from the old 0xAec1F48e... to the
 * correct Sepolia USDC Comet address 0xc3d688... which is what the
 * indexer actually scans and what users' transactions target.
 *
 * Resolves the chainKey dynamically via the CC3 precompile (same as
 * proveTransaction.cjs does) so the mapping key always matches what
 * the prover will use at submission time.
 *
 * Run once from the repo root:
 *   node scripts/updateCompoundAddress.cjs
 */

require("dotenv").config();
const { JsonRpcProvider, Contract, Wallet } = require("ethers");
const { chainInfo } = require("@gluwa/usc-sdk");

const CONTRACT_ABI = [
  "function setPoolAddress(uint64 chainKey, uint8 protocolId, address pool) external",
  "function poolAddressByChainAndProtocol(uint64, uint8) external view returns (address)",
  "function owner() external view returns (address)",
];

const SEPOLIA_CHAIN_ID = 11155111;
const COMPOUND_PROTOCOL_ID = 1;
const CORRECT_COMPOUND_ADDRESS = "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e";

async function main() {
  const { CC3_TESTNET_RPC, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

  if (!CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing CC3_TESTNET_RPC, PRIVATE_KEY, or CONTRACT_ADDRESS in .env");
  }

  const creditcoinProvider = new JsonRpcProvider(CC3_TESTNET_RPC);
  const signer = new Wallet(PRIVATE_KEY, creditcoinProvider);
  const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

  // Verify we're the owner
  const owner = await contract.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not the contract owner (${owner}). Cannot update pool address.`
    );
  }
  console.log(`✓ Signer is contract owner: ${signer.address}`);

  // Resolve the real chainKey from the CC3 precompile
  console.log("Resolving Sepolia chainKey from CC3 precompile...");
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  const sepoliaEntry = supportedChains.find((c) => c.chainId === SEPOLIA_CHAIN_ID);
  if (!sepoliaEntry) {
    throw new Error("Sepolia not found in getSupportedChains() — check CC3_TESTNET_RPC");
  }
  const chainKey = sepoliaEntry.chainKey;
  console.log(`✓ Sepolia chainKey: ${chainKey}`);

  // Show current registered address
  const current = await contract.poolAddressByChainAndProtocol(chainKey, COMPOUND_PROTOCOL_ID);
  console.log(`  Current Compound pool address: ${current}`);

  if (current.toLowerCase() === CORRECT_COMPOUND_ADDRESS.toLowerCase()) {
    console.log("✓ Already set to the correct address — nothing to do.");
    return;
  }

  // Update to the correct address
  console.log(`  Updating to: ${CORRECT_COMPOUND_ADDRESS}`);
  const tx = await contract.setPoolAddress(chainKey, COMPOUND_PROTOCOL_ID, CORRECT_COMPOUND_ADDRESS);
  console.log(`  tx submitted: ${tx.hash}`);
  await tx.wait();

  // Verify
  const updated = await contract.poolAddressByChainAndProtocol(chainKey, COMPOUND_PROTOCOL_ID);
  if (updated.toLowerCase() !== CORRECT_COMPOUND_ADDRESS.toLowerCase()) {
    throw new Error(`Update failed — contract still shows: ${updated}`);
  }
  console.log(`✅ Compound pool address updated to: ${updated}`);
  console.log("\nYou can now re-run: node scripts/proveQueue.cjs");
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
