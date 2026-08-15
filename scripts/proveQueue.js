/**
 * proveQueue.js
 *
 * Phase 2 item 4: same proof/submit mechanism as generateAndSubmitProof.js,
 * looped over the indexer's backlog instead of one .env-configured tx at a
 * time.
 *
 *  1. Pull up to PROVE_BATCH_SIZE (default 10) unproven events from the
 *     indexer's Postgres database (oldest block first).
 *  2. For each, run the same prove-and-submit flow as the single-tx script,
 *     using that event's own wallet + event type (not a single TARGET_WALLET
 *     / SOURCE_TX_HASH from .env).
 *  3. Mark each proven in Postgres immediately on success, so a mid-run
 *     crash doesn't re-prove or lose progress on the ones that already went
 *     through.
 *
 * Deliberately un-production, matching phase 2 item 5:
 *  - No retry/backoff on failure here — one bad event is logged and skipped,
 *    the rest of the batch keeps going. (The indexer's own retry/backoff on
 *    RPC rate limiting is unrelated and untouched.)
 *  - Not a long-running service — trigger manually or via cron
 *    (npm run prove-queue).
 *  - "Batch" means this script looping single-tx proveLoanEvent() calls, not
 *    a new on-chain batch-submit contract method — see CreditScoreMVP.sol,
 *    unchanged.
 *
 * Usage:
 *   npm run prove-queue                      # prove up to PROVE_BATCH_SIZE (default 10)
 *   PROVE_BATCH_SIZE=5 npm run prove-queue    # override batch size for this run
 */

require("dotenv").config();
const { proveTransaction } = require("./lib/proveTransaction");
const { EVENT_TYPE_INDEX } = require("./lib/eventTypes");
const { loadUnprovenEvents, markProven, disconnect } = require("../indexer/src/store");

const BATCH_SIZE = Number(process.env.PROVE_BATCH_SIZE || 10);

async function main() {
  const { SEPOLIA_RPC, CC3_TESTNET_RPC, PROVER_API_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

  if (!SEPOLIA_RPC || !CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error(
      "Missing required .env values (SEPOLIA_RPC, CC3_TESTNET_RPC, PRIVATE_KEY, CONTRACT_ADDRESS) — check .env.example."
    );
  }
  const proverApiUrl = PROVER_API_URL || "https://prover.cc3-testnet.creditcoin.network";

  let events;
  try {
    events = await loadUnprovenEvents(BATCH_SIZE);
  } catch (err) {
    await disconnect().catch(() => {});
    throw new Error(`Failed to load unproven events from Postgres: ${err.message}`);
  }

  if (events.length === 0) {
    console.log('No unproven events queued. Run "npm run index" in indexer/ first.');
    await disconnect();
    return;
  }

  console.log(`Found ${events.length} unproven event(s) — proving up to ${BATCH_SIZE} this run.`);

  const results = { proven: [], skipped: [], failed: [] };

  for (const event of events) {
    console.log(`\n--- ${event.eventName} | wallet=${event.wallet} | tx=${event.txHash} ---`);

    const eventType = EVENT_TYPE_INDEX[event.eventName];
    if (eventType === undefined) {
      const msg = `unrecognized eventName "${event.eventName}"`;
      console.error(`  ! ${msg}, skipping.`);
      results.failed.push({ txHash: event.txHash, error: msg });
      continue; // no retry/backoff by design — move on to the next event
    }

    try {
      const result = await proveTransaction({
        sourceTxHash: event.txHash,
        targetWallet: event.wallet,
        eventType,
        sepoliaRpc: SEPOLIA_RPC,
        cc3TestnetRpc: CC3_TESTNET_RPC,
        proverApiUrl,
        privateKey: PRIVATE_KEY,
        contractAddress: CONTRACT_ADDRESS,
        log: (msg) => console.log(msg),
      });

      // Mark proven in Postgres right away — on-chain state and DB state
      // should never drift apart just because a later event in this batch
      // fails.
      await markProven(event.txHash);

      if (result.alreadyProven) {
        console.log(`  already proven on-chain — marked proven in DB.`);
        results.skipped.push(event.txHash);
      } else {
        console.log(`  ✅ proven. score ${result.scoreBefore} -> ${result.scoreAfter}`);
        results.proven.push(event.txHash);
      }
    } catch (err) {
      console.error(`  ! failed: ${err.message}`);
      results.failed.push({ txHash: event.txHash, error: err.message });
      // Deliberately no retry/backoff here (phase 2 item 5) — log and
      // continue to the next event rather than let one bad event stall
      // the whole batch.
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Proven:  ${results.proven.length}`);
  console.log(`Skipped (already proven): ${results.skipped.length}`);
  console.log(`Failed:  ${results.failed.length}`);
  if (results.failed.length > 0) {
    for (const f of results.failed) console.log(`  ${f.txHash}: ${f.error}`);
  }

  await disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});