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
const { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes, AbiCoder } = require("ethers");
const { chainInfo, blockProver, proofProvider } = require("@gluwa/usc-sdk");
const { Pool } = require("pg");

// ABI without parameter names (Solidity selectors don't include parameter names)
const CONTRACT_ABI = [
  "function proveLoanEvent(address,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[],bytes32,uint8) external",
  "function score(address) external view returns (uint256)",
  "function provenTxHashes(bytes32) external view returns (bool)",
  "function getStats(address) external view returns (uint64,uint64,uint64,uint64,uint64)",
];

// Aave V3 Pool contract on Ethereum Sepolia — confirm this against
// https://github.com/bgd-labs/aave-address-book if Aave redeploys.
const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";

const EVENT_TYPE_INDEX = { Supply: 0, Borrow: 1, Repay: 2, Withdraw: 3, LiquidationCall: 4 };

async function lookupEventType(sourceTxHash) {
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error("Missing DATABASE_URL — needed to look up the event type for SOURCE_TX_HASH.");
  }
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rows } = await pool.query(
      'SELECT "eventName" FROM "IndexedEvent" WHERE "txHash" = $1 LIMIT 1',
      [sourceTxHash]
    );
    if (rows.length === 0) {
      throw new Error(
        `SOURCE_TX_HASH ${sourceTxHash} not found in the indexer's database. ` +
        `Run "npm run index" in indexer/ first, or pick a tx hash the indexer already discovered.` 
      );
    }
    const eventName = rows[0].eventName;
    if (!(eventName in EVENT_TYPE_INDEX)) {
      throw new Error(`Unrecognized eventName "${eventName}" from indexer DB.`);
    }
    return EVENT_TYPE_INDEX[eventName];
  } finally {
    await pool.end();
  }
}

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
  
  // Use default PROVER_API_URL if not provided
  const proverApiUrl = PROVER_API_URL || "https://prover.cc3-testnet.creditcoin.network";

  const sourceProvider = new JsonRpcProvider(SEPOLIA_RPC);
  const creditcoinProvider = new JsonRpcProvider(CC3_TESTNET_RPC);

  // --- Step 1: find the chainKey for Sepolia ---
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  console.log("Supported chains reported by Creditcoin:", supportedChains);

  const sepoliaEntry = supportedChains.find((c) =>
    c.chainId === 11155111 // Ethereum Sepolia chain ID
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

  // Guard: Attestcoin will happily generate a proof for ANY confirmed
  // transaction — it has no concept of "Aave" or "loan event." That check
  // has to happen here, off-chain, before we bother proving/submitting.
  if (!tx.to || tx.to.toLowerCase() !== AAVE_V3_SEPOLIA_POOL.toLowerCase()) {
    throw new Error(
      `SOURCE_TX_HASH was not sent to the Aave Pool contract (expected ${AAVE_V3_SEPOLIA_POOL}, got ${tx.to}). ` +
      `Refusing to prove/score a non-Aave transaction. Run "npm run test-tx -- ${SOURCE_TX_HASH}" to double check before retrying.`
    );
  }
  console.log("✅ Confirmed: transaction target is the Aave V3 Sepolia Pool contract.");

  const eventType = await lookupEventType(SOURCE_TX_HASH);
  console.log("Event type (from indexer DB):", Object.keys(EVENT_TYPE_INDEX)[eventType], `(${eventType})`);

  // --- Step 3: wait for attestation, then generate the real proof ---
  const proofBuilder = new proofProvider.service.ProofBuilder(
    chainKey,
    proverApiUrl // now https://prover.cc3-testnet.creditcoin.network
  );

  console.log("Waiting for block attestation (this can take a few minutes)...");
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber);
  console.log(`✅ Block ${blockNumber} is attested.`);

  const result = await proofBuilder.getProof(SOURCE_TX_HASH);
  if (!result.success || !result.data) {
    throw new Error(`Proof generation failed: ${result.error}`);
  }

  const { headerNumber, txBytes, merkleProof, continuityProof } = result.data;
  console.log("✅ Real Merkle + continuity proof received from prover service.");

  // --- Step 4: submit to your contract on Creditcoin ---
  const wallet = new Wallet(PRIVATE_KEY, creditcoinProvider);
  const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

  // Use the actual transaction hash as the key to ensure uniqueness
  const txHashKey = keccak256(toUtf8Bytes(SOURCE_TX_HASH));
  
  // Check if already proven
  try {
    const alreadyProven = await contract.provenTxHashes(txHashKey);
    if (alreadyProven) {
      console.log("⚠️  This transaction has already been proven on this contract");
      console.log("Score:", (await contract.score(TARGET_WALLET)).toString());
      console.log("To prove it again, either:");
      console.log("  1. Deploy a fresh contract (npm run deploy)");
      console.log("  2. Use a different source transaction");
      console.log("  3. Comment out the 'already proven' check in the contract");
      return;
    }
  } catch (error) {
    // Function might not be in ABI, continue
  }

  const scoreBefore = await contract.score(TARGET_WALLET);
  console.log(`Score before: ${scoreBefore}`);

  console.log("Submitting proof to CreditScoreMVP contract...");
  console.log("Proof values:");
  console.log("  headerNumber:", headerNumber);
  console.log("  txBytes:", txBytes ? `${txBytes.substring(0, 50)}...` : "UNDEFINED");
  console.log("  merkleRoot:", merkleProof.root);
  console.log("  merkleSiblings:", merkleProof.siblings.length, "entries");
  console.log("  lowerEndpointDigest:", continuityProof.lowerEndpointDigest);
  console.log("  continuityRoots:", continuityProof.roots.length, "entries");
  console.log("  txHashKey:", txHashKey);

  // Convert sibling objects to arrays for ethers.js ABI encoding
  const siblingsArray = merkleProof.siblings.map(sibling => [
    sibling.hash,
    sibling.isLeft
  ]);

  const submitTx = await contract.proveLoanEvent(
    TARGET_WALLET,
    chainKey,
    headerNumber,
    txBytes,
    merkleProof.root,
    siblingsArray,
    continuityProof.lowerEndpointDigest,
    continuityProof.roots,
    txHashKey,
    eventType
  );
  console.log("Tx submitted:", submitTx.hash);
  await submitTx.wait();
  console.log("Confirmed.");

  // --- Step 5: read back the result ---
  const scoreAfter = await contract.score(TARGET_WALLET);
  const [supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount] =
    await contract.getStats(TARGET_WALLET);
  
  console.log(`Score after: ${scoreAfter}`);
  console.log("Breakdown:");
  console.log(`  Supply:      ${supplyCount} × 5   = ${supplyCount * 5n}`);
  console.log(`  Borrow:      ${borrowCount} × 2   = ${borrowCount * 2n}`);
  console.log(`  Repay:       ${repayCount} × 15  = ${repayCount * 15n}`);
  console.log(`  Withdraw:    ${withdrawCount} × 0   = 0`);
  console.log(`  Liquidation: ${liquidationCount} × -20 = ${liquidationCount * -20n}`);

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
