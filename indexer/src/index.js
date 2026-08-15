/**
 * Indexer entrypoint. Scans Aave V3's Pool contract on Ethereum Sepolia for
 * Supply/Borrow/Repay/Withdraw/LiquidationCall events, for any wallet, and
 * appends newly-seen ones to data/events.json.
 *
 * This does discovery only. It does NOT generate or submit proofs — that's
 * the main repo's generateAndSubmitProof.js, driven by SOURCE_TX_HASH.
 * See README.md for how the two connect.
 *
 * Usage:
 *   npm run index                            # scan from checkpoint (or START_BLOCK) to latest
 *   npm run index -- --from-block 1234567    # override checkpoint, re-scan from this block
 */

require("dotenv").config();
const { JsonRpcProvider, Contract, Interface } = require("ethers");
const { AAVE_V3_SEPOLIA_POOL, POOL_EVENT_ABI, EVENT_NAMES, CHUNK_SIZE } = require("./config");
const { extractWallet, extractAssetAndAmount } = require("./aaveDecoder");
const { loadCheckpoint, saveCheckpoint, getSeenKeys, saveEvent, disconnect } = require("./store");

// Retry configuration for RPC rate limiting
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const QUERY_DELAY = 500; // 500ms delay between event type queries

async function retryWithBackoff(fn, context = "") {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit = err.code === -32005 || err.message?.includes("Too Many Requests") || err.message?.includes("429");
      
      if (!isRateLimit || attempt === MAX_RETRIES) {
        throw err;
      }
      
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
      console.log(`  ! Rate limited on ${context}, retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from-block") {
      out.fromBlock = Number(args[i + 1]);
      i++;
    }
  }
  return out;
}

function resolveFromBlock({ cliFromBlock, checkpointBlock, startBlockEnv, latestBlock }) {
  if (cliFromBlock != null) return cliFromBlock; // explicit override wins
  if (checkpointBlock != null) return checkpointBlock + 1; // normal resume path
  if (startBlockEnv) return Number(startBlockEnv); // first-ever run, configured start
  return latestBlock; // first-ever run, no config: start from "now"
}

async function main() {
  const { SEPOLIA_RPC, START_BLOCK } = process.env;
  if (!SEPOLIA_RPC) {
    throw new Error("Missing SEPOLIA_RPC — check .env.example.");
  }

  const cli = parseArgs();
  const provider = new JsonRpcProvider(SEPOLIA_RPC);
  const iface = new Interface(POOL_EVENT_ABI);
  const contract = new Contract(AAVE_V3_SEPOLIA_POOL, POOL_EVENT_ABI, provider);

  const chain = "sepolia";
  const contractAddress = AAVE_V3_SEPOLIA_POOL;
  
  const checkpoint = await loadCheckpoint(chain, contractAddress);
  const seenKeys = await getSeenKeys();

  const latestBlock = await retryWithBackoff(() => provider.getBlockNumber(), "getBlockNumber");
  const fromBlock = resolveFromBlock({
    cliFromBlock: cli.fromBlock,
    checkpointBlock: checkpoint.lastIndexedBlock,
    startBlockEnv: START_BLOCK,
    latestBlock,
  });

  if (fromBlock > latestBlock) {
    console.log(`Nothing to do — fromBlock (${fromBlock}) is ahead of latest (${latestBlock}).`);
    await disconnect();
    return;
  }

  console.log(`Indexing Aave Pool ${AAVE_V3_SEPOLIA_POOL} on Sepolia`);
  console.log(`Range: ${fromBlock} -> ${latestBlock} (chunk size ${CHUNK_SIZE})`);

  let newCount = 0;
  const blockTimestampCache = new Map(); // Cache block timestamps to avoid redundant calls

  try {
    for (let start = fromBlock; start <= latestBlock; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, latestBlock);
      process.stdout.write(`  scanning ${start}-${end}... `);

      // One queryFilter per event type keeps ABI decoding unambiguous and
      // makes a failure on one event type easy to isolate and retry.
      for (const eventName of EVENT_NAMES) {
        let logs;
        try {
          logs = await retryWithBackoff(
            () => contract.queryFilter(contract.filters[eventName](), start, end),
            `${eventName} (${start}-${end})`
          );
        } catch (err) {
          console.error(`\n  ! queryFilter(${eventName}, ${start}, ${end}) failed after retries: ${err.message}`);
          console.error(`  Consider lowering INDEXER_CHUNK_SIZE (current: ${CHUNK_SIZE}) and re-running.`);
          throw err;
        }

        // Small delay between event types to avoid rate limiting
        if (EVENT_NAMES.indexOf(eventName) < EVENT_NAMES.length - 1) {
          await new Promise(resolve => setTimeout(resolve, QUERY_DELAY));
        }

        for (const log of logs) {
          const key = `${log.transactionHash}:${log.index}`;
          if (seenKeys.has(key)) continue;

          const parsed = iface.parseLog(log);
          const wallet = extractWallet(eventName, parsed.args);
          const { asset, amount } = extractAssetAndAmount(eventName, parsed.args);

          // Get block timestamp (cached per block number)
          let timestamp;
          if (blockTimestampCache.has(log.blockNumber)) {
            timestamp = blockTimestampCache.get(log.blockNumber);
          } else {
            const block = await retryWithBackoff(
              () => provider.getBlock(log.blockNumber),
              `getBlock(${log.blockNumber})`
            );
            timestamp = block.timestamp;
            blockTimestampCache.set(log.blockNumber, timestamp);
          }

          await saveEvent({
            txHash: log.transactionHash,
            logIndex: log.index,
            blockNumber: log.blockNumber,
            eventName,
            wallet,
            asset,
            amount,
            chain: "sepolia", // Hardcoded for single-chain MVP
            timestamp,
            proven: false, // flip to true out-of-band once generateAndSubmitProof.js succeeds for this txHash
          });
          seenKeys.add(key);
          newCount++;
        }
      }
      process.stdout.write("done\n");
    }

    await saveCheckpoint(chain, contractAddress, latestBlock);

    console.log(`\nIndexed ${newCount} new event(s). Checkpoint advanced to block ${latestBlock}.`);
    
    // Load events for summary
    const { loadEvents } = require('./store');
    const eventStore = await loadEvents();
    printSummary(eventStore);
  } finally {
    await disconnect();
  }
}

function printSummary(eventStore) {
  const unproven = eventStore.filter((e) => !e.proven);
  if (unproven.length === 0) {
    console.log("No unproven events queued.");
    return;
  }
  console.log(`\n${unproven.length} event(s) ready to prove (SOURCE_TX_HASH candidates):`);
  for (const e of unproven.slice(0, 10)) {
    console.log(`  ${e.eventName.padEnd(15)} wallet=${e.wallet} block=${e.blockNumber} tx=${e.txHash}`);
  }
  if (unproven.length > 10) console.log(`  ... and ${unproven.length - 10} more`);
  console.log(
    `\nNote: batch cap is 10 queries per continuity proof — batch in groups of <=10 if you automate the prove step.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
