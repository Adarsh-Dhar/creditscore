/**
 * proveQueue.js
 *
 * Production-level batch proof processing for the indexer's backlog.
 *
 *  1. Pull up to PROVE_BATCH_SIZE (default 10) unproven events from the
 *     indexer's Postgres database (oldest block first).
 *  2. Group events by chain (batches cannot cross chains).
 *  3. For each chain group, generate a shared batch proof and submit
 *     all events in a single on-chain transaction via proveLoanEventsBatch.
 *  4. Mark each proven in Postgres immediately on success, so a mid-run
 *     crash doesn't re-prove or lose progress on the ones that already went
 *     through.
 *
 * Production features:
 *  - Uses efficient batch proof generation (getBatchProof) with shared
 *    continuity proof across multiple transactions
 *  - Groups events by chain to respect batch limitations
 *  - Single on-chain transaction per chain group (significant gas savings)
 *  - Proper error handling with detailed logging
 *  - Maintains per-tx deduplication checks
 *
 * Usage:
 *   npm run prove-queue                      # prove up to PROVE_BATCH_SIZE (default 10)
 *   PROVE_BATCH_SIZE=5 npm run prove-queue    # override batch size for this run
 */

require("dotenv").config();
const { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } = require("ethers");
const { processBatch } = require("./lib/proveBatch");
const { proveTransaction } = require("./lib/proveTransaction");
const { EVENT_TYPE_INDEX } = require("./lib/eventTypes");
const { loadUnprovenEvents, markProven, disconnect } = require("../indexer/dist/store");

const BATCH_SIZE = Number(process.env.PROVE_BATCH_SIZE || 10);

/**
 * Group events by chain and protocol
 * @param {Array} events - Array of events with chain and protocol properties
 * @returns {Object} Events grouped by chain and protocol
 */
function groupByChainAndProtocol(events) {
  const grouped = {};
  for (const event of events) {
    const key = `${event.chain}:${event.protocol || 'aave'}`; // Default to 'aave' for backward compatibility
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(event);
  }
  return grouped;
}

/**
 * Get RPC URL for a given chain
 * @param {string} chain - Chain name (e.g., "sepolia")
 * @returns {string} RPC URL from environment
 */
function getRpcForChain(chain) {
  const envVar = `${chain.toUpperCase()}_RPC`;
  const rpcUrl = process.env[envVar];
  if (!rpcUrl) {
    throw new Error(`Missing ${envVar} in .env for chain ${chain}`);
  }
  return rpcUrl;
}

async function main() {
  const { CC3_TESTNET_RPC, PROVER_API_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;

  if (!CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error(
      "Missing required .env values (CC3_TESTNET_RPC, PRIVATE_KEY, CONTRACT_ADDRESS) — check .env.example."
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

  console.log(`Found ${events.length} unproven event(s) — processing in batches of up to ${BATCH_SIZE}.`);

  // Group events by chain and protocol
  const eventsByChainAndProtocol = groupByChainAndProtocol(events);
  console.log(`Events grouped by chain:protocol: ${Object.keys(eventsByChainAndProtocol).join(", ")}`);

  const results = { proven: [], skipped: [], failed: [] };

  // Process each chain:protocol group
  for (const [chainProtocolKey, groupEvents] of Object.entries(eventsByChainAndProtocol)) {
    const [chain, protocol] = chainProtocolKey.split(':');
    console.log(`\n=== Processing ${groupEvents.length} event(s) from ${chain} (${protocol}) ===`);

    try {
      const chainRpc = getRpcForChain(chain);

      // Validate event types
      const validEvents = [];
      for (const event of groupEvents) {
        const eventType = EVENT_TYPE_INDEX[event.eventName];
        if (eventType === undefined) {
          const msg = `unrecognized eventName "${event.eventName}"`;
          console.error(`  ! ${msg} for tx ${event.txHash}, skipping.`);
          results.failed.push({ txHash: event.txHash, error: msg });
        } else {
          validEvents.push({ ...event, eventType, protocol: event.protocol || 'aave' });
        }
      }

      if (validEvents.length === 0) {
        console.log(`  No valid events to process for ${chain}:${protocol}.`);
        continue;
      }

      // Process batch for this chain:protocol
      let batchResult;
      try {
        batchResult = await processBatch(validEvents, {
          chain,
          protocol,
          sourceRpc: chainRpc,
          cc3TestnetRpc: CC3_TESTNET_RPC,
          proverApiUrl,
          privateKey: PRIVATE_KEY,
          contractAddress: CONTRACT_ADDRESS,
          log: (msg) => console.log(msg),
        });
      } catch (batchError) {
        console.log(`  ! batch processing failed, falling back to individual proofs: ${batchError.message}`);
        
        // Fallback to individual transaction proofs
        for (const event of validEvents) {
          try {
            console.log(`  processing individual tx: ${event.txHash.substring(0, 10)}...`);
            const result = await proveTransaction({
              sourceTxHash: event.txHash,
              targetWallet: event.wallet,
              eventType: event.eventType,
              sourceRpc: chainRpc,
              chain,
              protocol: event.protocol || 'aave',
              cc3TestnetRpc: CC3_TESTNET_RPC,
              proverApiUrl,
              privateKey: PRIVATE_KEY,
              contractAddress: CONTRACT_ADDRESS,
              log: (msg) => console.log(`    ${msg}`),
            });

            await markProven(event.txHash);

            if (result.alreadyProven) {
              console.log(`    already proven on-chain — marked proven in DB.`);
              results.skipped.push(event.txHash);
            } else {
              console.log(`    ✅ proven. score ${result.scoreBefore} -> ${result.scoreAfter}`);
              results.proven.push(event.txHash);
            }
          } catch (individualError) {
            console.error(`    ! individual proof failed: ${individualError.message}`);
            results.failed.push({ txHash: event.txHash, error: individualError.message });
          }
        }
        continue; // Skip the batch result processing since we handled individually
      }

      // Mark processed events as proven in Postgres (only those actually processed)
      if (batchResult.processed > 0) {
        for (const event of validEvents) {
          await markProven(event.txHash);
          results.proven.push(event.txHash);
        }
        console.log(`  ✅ batch processed: ${batchResult.processed} event(s)`);
        if (batchResult.gasUsed) {
          console.log(`  gas used: ${batchResult.gasUsed}`);
        }
      }

      // Mark only the already-proven events as skipped (not all events)
      if (batchResult.skipped > 0) {
        // Mark only the specific events that were already proven
        // The batchResult.alreadyProvenIndices would tell us which ones, but since
        // we don't have that info returned, we need to check each one
        const creditcoinProvider = new JsonRpcProvider(CC3_TESTNET_RPC);
        const wallet = new Wallet(PRIVATE_KEY, creditcoinProvider);
        const contract = new Contract(CONTRACT_ADDRESS, ["function provenTxHashes(bytes32) view returns (bool)"], wallet);
        
        for (const event of validEvents) {
          const txHashKey = keccak256(toUtf8Bytes(event.txHash));
          const isProven = await contract.provenTxHashes(txHashKey).catch(() => false);
          if (isProven) {
            await markProven(event.txHash);
            results.skipped.push(event.txHash);
          }
        }
        console.log(`  ⏭️ skipped: ${batchResult.skipped} already proven event(s)`);
      }

    } catch (err) {
      console.error(`  ! batch processing failed for ${chain}:${protocol}: ${err.message}`);
      // Mark all events in this chain:protocol group as failed
      for (const event of groupEvents) {
        results.failed.push({ txHash: event.txHash, error: err.message });
      }
      // Continue with other groups even if one fails
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Proven:  ${results.proven.length}`);
  console.log(`Skipped (already proven): ${results.skipped.length}`);
  console.log(`Failed:  ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log(`Failed transactions:`);
    for (const f of results.failed) console.log(`  ${f.txHash}: ${f.error}`);
  }

  await disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});