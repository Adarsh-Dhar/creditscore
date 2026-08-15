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
const { loadCheckpoint, saveCheckpoint, loadEvents, saveEvents } = require("./store");

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

  const checkpoint = loadCheckpoint();
  const eventStore = loadEvents();
  const seenKeys = new Set(eventStore.map((e) => `${e.txHash}:${e.logIndex}`));

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = resolveFromBlock({
    cliFromBlock: cli.fromBlock,
    checkpointBlock: checkpoint.lastIndexedBlock,
    startBlockEnv: START_BLOCK,
    latestBlock,
  });

  if (fromBlock > latestBlock) {
    console.log(`Nothing to do — fromBlock (${fromBlock}) is ahead of latest (${latestBlock}).`);
    return;
  }

  console.log(`Indexing Aave Pool ${AAVE_V3_SEPOLIA_POOL} on Sepolia`);
  console.log(`Range: ${fromBlock} -> ${latestBlock} (chunk size ${CHUNK_SIZE})`);

  let newCount = 0;

  for (let start = fromBlock; start <= latestBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, latestBlock);
    process.stdout.write(`  scanning ${start}-${end}... `);

    // One queryFilter per event type keeps ABI decoding unambiguous and
    // makes a failure on one event type easy to isolate and retry.
    for (const eventName of EVENT_NAMES) {
      let logs;
      try {
        logs = await contract.queryFilter(contract.filters[eventName](), start, end);
      } catch (err) {
        console.error(`\n  ! queryFilter(${eventName}, ${start}, ${end}) failed: ${err.message}`);
        console.error(`  Consider lowering INDEXER_CHUNK_SIZE (current: ${CHUNK_SIZE}) and re-running.`);
        throw err;
      }

      for (const log of logs) {
        const key = `${log.transactionHash}:${log.index}`;
        if (seenKeys.has(key)) continue;

        const parsed = iface.parseLog(log);
        const wallet = extractWallet(eventName, parsed.args);
        const { asset, amount } = extractAssetAndAmount(eventName, parsed.args);

        eventStore.push({
          txHash: log.transactionHash,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          eventName,
          wallet,
          asset,
          amount,
          proven: false, // flip to true out-of-band once generateAndSubmitProof.js succeeds for this txHash
        });
        seenKeys.add(key);
        newCount++;
      }
    }
    process.stdout.write("done\n");
  }

  checkpoint.lastIndexedBlock = latestBlock;
  saveCheckpoint(checkpoint);
  saveEvents(eventStore);

  console.log(`\nIndexed ${newCount} new event(s). Checkpoint advanced to block ${latestBlock}.`);
  printSummary(eventStore);
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
