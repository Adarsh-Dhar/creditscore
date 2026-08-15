/**
 * generateAndSubmitProof.js
 *
 * The core single-transaction demo script. Thin CLI wrapper around
 * scripts/lib/proveTransaction.js — reads SOURCE_TX_HASH/TARGET_WALLET from
 * .env, looks up the event type for that tx from the indexer's Postgres
 * database, and proves+submits it.
 *
 * For proving many queued events in one run instead of one at a time, see
 * scripts/proveQueue.js (npm run prove-queue).
 *
 * IMPORTANT: The @gluwa/usc-sdk exact API (method/class names) may have
 * shifted since this was written, especially around the v2 -> CC3 Testnet
 * migration. If any import or method call errors, check the current SDK
 * README (npm view @gluwa/usc-sdk, or the docs.creditcoin.org USC SDK page)
 * and adjust scripts/lib/proveTransaction.js accordingly — the overall flow
 * should still be correct even if exact names differ slightly.
 */

require("dotenv").config();
const { Pool } = require("pg");
const { proveTransaction, AAVE_V3_SEPOLIA_POOL } = require("./lib/proveTransaction");
const { EVENT_TYPE_INDEX, EVENT_TYPE_NAMES } = require("./lib/eventTypes");

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

  const proverApiUrl = PROVER_API_URL || "https://prover.cc3-testnet.creditcoin.network";

  console.log("Confirming transaction target is the Aave V3 Sepolia Pool contract:", AAVE_V3_SEPOLIA_POOL);

  const eventType = await lookupEventType(SOURCE_TX_HASH);
  console.log("Event type (from indexer DB):", EVENT_TYPE_NAMES[eventType], `(${eventType})`);

  const result = await proveTransaction({
    sourceTxHash: SOURCE_TX_HASH,
    targetWallet: TARGET_WALLET,
    eventType,
    sepoliaRpc: SEPOLIA_RPC,
    cc3TestnetRpc: CC3_TESTNET_RPC,
    proverApiUrl,
    privateKey: PRIVATE_KEY,
    contractAddress: CONTRACT_ADDRESS,
  });

  if (result.alreadyProven) {
    console.log("⚠️  This transaction has already been proven on this contract");
    console.log("Score:", result.scoreBefore.toString());
    console.log("To prove it again, either:");
    console.log("  1. Deploy a fresh contract (npm run deploy)");
    console.log("  2. Use a different source transaction");
    console.log("  3. Comment out the 'already proven' check in the contract");
    return;
  }

  console.log(`Score before: ${result.scoreBefore}`);
  console.log("Tx submitted and confirmed:", result.txHash);
  console.log(`Score after: ${result.scoreAfter}`);

  const { supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount } = result.stats;
  console.log("Breakdown:");
  console.log(`  Supply:      ${supplyCount} × 5   = ${supplyCount * 5n}`);
  console.log(`  Borrow:      ${borrowCount} × 2   = ${borrowCount * 2n}`);
  console.log(`  Repay:       ${repayCount} × 15  = ${repayCount * 15n}`);
  console.log(`  Withdraw:    ${withdrawCount} × 0   = 0`);
  console.log(`  Liquidation: ${liquidationCount} × -20 = ${liquidationCount * -20n}`);

  if (result.scoreAfter > result.scoreBefore) {
    console.log("\n✅ SUCCESS — score increased. The Sepolia transaction was cryptographically verified via Attestcoin and reflected on Creditcoin.");
  } else {
    console.log("\n⚠️ Score did not increase — check logs above for errors.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});