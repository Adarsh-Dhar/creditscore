/**
 * generateAndSubmitProof.js
 *
 * The core demo script. Does exactly one thing end-to-end:
 *  1. Finds which block your target Sepolia transaction is in.
 *  2. Waits until Creditcoin has attested that block.
 *  3. Fetches an inclusion proof (Merkle + continuity) for the transaction.
 *  4. Submits that proof to your deployed CreditScoreMVP contract on Creditcoin.
 *  5. Prints the wallet's score before and after, so you can see it change.
 *
 * IMPORTANT: The @gluwa/usc-sdk exact API (method/class names) may have
 * shifted since this was written, especially around the v2 -> CC3 Testnet
 * migration. If any import or method call below errors, check the current
 * SDK README (npm view @gluwa/usc-sdk, or the docs.creditcoin.org USC SDK
 * page) and adjust accordingly — the shape of this script should still be
 * correct even if exact names differ slightly.
 */

require("dotenv").config();
const { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } = require("ethers");
const { chainInfo, blockProver, proofGenerator } = require("@gluwa/usc-sdk");

const CONTRACT_ABI = [
  "function proveLoanEvent(address wallet, uint256 chainKey, uint256 blockHeight, bytes encodedTx, bytes merkleProof, bytes continuityProof, bytes32 txHashKey) external",
  "function score(address wallet) external view returns (uint256)",
];

async function main() {
  const {
    SEPOLIA_RPC,
    CC3_TESTNET_RPC,
    PROVER_API_URL,
    PRIVATE_KEY,
    CONTRACT_ADDRESS,
    TARGET_WALLET,
    SOURCE_TX_HASH,
  } = process.env;

  if (!SEPOLIA_RPC || !CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS || !TARGET_WALLET || !SOURCE_TX_HASH) {
    throw new Error("Missing required .env values — check .env.example for the full list.");
  }

  const sourceProvider = new JsonRpcProvider(SEPOLIA_RPC);
  const creditcoinProvider = new JsonRpcProvider(CC3_TESTNET_RPC);

  // --- Step 1: find the chainKey for Sepolia ---
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  console.log("Supported chains reported by Creditcoin:", supportedChains);

  const sepoliaEntry = supportedChains.find((c) =>
    c.chainName?.toLowerCase().includes("sepolia")
  );
  if (!sepoliaEntry) {
    throw new Error(
      "No Sepolia entry found in getSupportedChains() — verify current chain support before continuing."
    );
  }
  const chainKey = sepoliaEntry.chainKey;
  console.log("Using chainKey:", chainKey);

  // --- Step 2: locate the transaction's block ---
  const tx = await sourceProvider.getTransaction(SOURCE_TX_HASH);
  if (!tx) throw new Error("Transaction not found on Sepolia — check SOURCE_TX_HASH.");
  const blockNumber = tx.blockNumber;
  console.log("Target tx is in block:", blockNumber);

  // --- Step 3: wait for attestation, then generate the proof ---
  const proofGenApi = new proofGenerator.api.ProverAPIProofGenerator(
    chainKey,
    PROVER_API_URL || "https://prover.usc-testnet.creditcoin.network",
    5000
  );

  console.log("Waiting until Creditcoin has attested this block (this can take a few minutes)...");
  await proofGenApi.waitUntilHeightAttested(blockNumber);

  console.log("Generating proof...");
  const proof = await proofGenApi.generateProof(SOURCE_TX_HASH);
  // proof is expected to contain: encodedTx, merkleProof, continuityProof
  // (exact field names depend on SDK version — log it to confirm)
  console.log("Proof generated:", proof);

  // --- Step 4: submit to your contract on Creditcoin ---
  const wallet = new (require("ethers").Wallet)(PRIVATE_KEY, creditcoinProvider);
  const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

  const txHashKey = keccak256(toUtf8Bytes(SOURCE_TX_HASH));

  const scoreBefore = await contract.score(TARGET_WALLET);
  console.log(`Score before: ${scoreBefore}`);

  console.log("Submitting proof to CreditScoreMVP contract...");
  const submitTx = await contract.proveLoanEvent(
    TARGET_WALLET,
    chainKey,
    blockNumber,
    proof.encodedTx,
    proof.merkleProof,
    proof.continuityProof,
    txHashKey
  );
  console.log("Tx submitted:", submitTx.hash);
  await submitTx.wait();
  console.log("Confirmed.");

  // --- Step 5: read back the result ---
  const scoreAfter = await contract.score(TARGET_WALLET);
  console.log(`Score after: ${scoreAfter}`);

  if (scoreAfter > scoreBefore) {
    console.log("\n✅ SUCCESS — score increased. The Sepolia transaction was cryptographically verified via Attestcoin and reflected on Creditcoin.");
  } else {
    console.log("\n⚠️ Score did not increase — check logs above for errors.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
