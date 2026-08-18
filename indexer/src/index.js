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
const { CHAINS, POOL_EVENT_ABI, CHAIN_EVENT_ABIS, EVENT_NAMES, CHUNK_SIZE } = require("./config");
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
  const cli = parseArgs();
  const seenKeys = await getSeenKeys();

  let totalNewCount = 0;

  try {
    // Process each chain independently
    for (const chainConfig of CHAINS) {
      const { name: chain, rpcEnvVar, poolAddress: contractAddress, numericChainId } = chainConfig;
      const rpcUrl = process.env[rpcEnvVar];

      if (!rpcUrl) {
        console.log(`Skipping ${chain}: missing ${rpcEnvVar} in .env`);
        continue;
      }

      console.log(`\n=== Processing chain: ${chain} ===`);
      const provider = new JsonRpcProvider(rpcUrl);
      const chainAbi = CHAIN_EVENT_ABIS[chain] || POOL_EVENT_ABI;
      const iface = new Interface(chainAbi);
      const contract = new Contract(contractAddress, chainAbi, provider);

      const checkpoint = await loadCheckpoint(chain, contractAddress);

      const latestBlock = await retryWithBackoff(() => provider.getBlockNumber(), "getBlockNumber");
      const fromBlock = resolveFromBlock({
        cliFromBlock: cli.fromBlock,
        checkpointBlock: checkpoint.lastIndexedBlock,
        startBlockEnv: process.env[`START_BLOCK_${chain.toUpperCase()}`],
        latestBlock,
      });

      if (fromBlock > latestBlock) {
        console.log(`Nothing to do for ${chain} — fromBlock (${fromBlock}) is ahead of latest (${latestBlock}).`);
        continue;
      }

      console.log(`Indexing Aave Pool ${contractAddress} on ${chain}`);
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
                chain, // Use the chain name from config
                timestamp,
                proven: false, // flip to true out-of-band once proof succeeds for this txHash
              });
              seenKeys.add(key);
              newCount++;
            }
          }
          process.stdout.write("done\n");
        }

        await saveCheckpoint(chain, contractAddress, latestBlock);

        console.log(`Indexed ${newCount} new event(s) on ${chain}. Checkpoint advanced to block ${latestBlock}.`);
        totalNewCount += newCount;
      } catch (err) {
        console.error(`Error processing chain ${chain}: ${err.message}`);
        // Continue with other chains even if one fails
      }
    }

    console.log(`\n=== Total: ${totalNewCount} new event(s) indexed across all chains ===`);

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

  // Group by chain for better organization
  const byChain = {};
  for (const e of unproven) {
    if (!byChain[e.chain]) {
      byChain[e.chain] = [];
    }
    byChain[e.chain].push(e);
  }

  console.log(`\n${unproven.length} event(s) ready to prove across ${Object.keys(byChain).length} chain(s):`);
  
  for (const [chain, chainEvents] of Object.entries(byChain)) {
    console.log(`\n  ${chain} (${chainEvents.length} events):`);
    for (const e of chainEvents.slice(0, 5)) {
      console.log(`    ${e.eventName.padEnd(15)} wallet=${e.wallet} block=${e.blockNumber} tx=${e.txHash}`);
    }
    if (chainEvents.length > 5) console.log(`    ... and ${chainEvents.length - 5} more`);
  }

  console.log(
    `\nNote: batch cap is 10 queries per continuity proof per chain — batch in groups of <=10 per chain.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
