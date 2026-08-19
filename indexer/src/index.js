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
const { CHAINS, AAVE_EVENT_ABI, AAVE_WETHGATEWAY_EVENT_ABI, COMPOUND_EVENT_ABI, MORPHO_EVENT_ABI, EVENT_NAME_MAP, GENERIC_EVENT_NAMES, CHUNK_SIZE } = require("./config");
const { extractWallet: extractAaveWallet, extractAssetAndAmount: extractAaveAssetAndAmount } = require("./aaveDecoder");
const { extractWallet: extractCompoundWallet, extractAssetAndAmount: extractCompoundAssetAndAmount, classifyCompoundEvent } = require("./compoundDecoder");
const { extractWallet: extractMorphoWallet, extractAssetAndAmount: extractMorphoAssetAndAmount } = require("./morphoDecoder");
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
      const { name: chain, rpcEnvVar, numericChainId, protocols } = chainConfig;
      const rpcUrl = process.env[rpcEnvVar];

      if (!rpcUrl) {
        console.log(`Skipping ${chain}: missing ${rpcEnvVar} in .env`);
        continue;
      }

      console.log(`\n=== Processing chain: ${chain} ===`);
      const provider = new JsonRpcProvider(rpcUrl);

      // Process each protocol within the chain
      for (const protocolConfig of protocols) {
        const { id: protocol, poolAddress: contractAddress, abi, wethGatewayAddress, wethGatewayAbi } = protocolConfig;
        
        if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
          console.log(`Skipping ${protocol} on ${chain}: pool address not configured`);
          continue;
        }

        console.log(`Processing protocol: ${protocol} (${contractAddress})`);
        
        // For Aave, also process WETHGateway if configured
        const contractsToIndex = [];
        
        contractsToIndex.push({
          type: 'pool',
          address: contractAddress,
          abi: abi,
        });
        
        if (protocol === 'aave' && wethGatewayAddress && wethGatewayAddress !== "0x0000000000000000000000000000000000000000") {
          contractsToIndex.push({
            type: 'gateway',
            address: wethGatewayAddress,
            abi: wethGatewayAbi,
          });
          console.log(`Also indexing WETHGateway: ${wethGatewayAddress}`);
        }

        for (const contractConfig of contractsToIndex) {
          const { type, address: contractAddress, abi: contractAbi } = contractConfig;
          
          console.log(`Indexing ${protocol} ${type} ${contractAddress} on ${chain}`);
          const iface = new Interface(contractAbi);
          const contract = new Contract(contractAddress, contractAbi, provider);

          const checkpoint = await loadCheckpoint(chain, contractAddress);

          const latestBlock = await retryWithBackoff(() => provider.getBlockNumber(), "getBlockNumber");
          const fromBlock = resolveFromBlock({
            cliFromBlock: cli.fromBlock,
            checkpointBlock: checkpoint.lastIndexedBlock,
            startBlockEnv: process.env[`START_BLOCK_${chain.toUpperCase()}`],
            latestBlock,
          });

          if (fromBlock > latestBlock) {
            console.log(`Nothing to do for ${protocol} ${type} on ${chain} — fromBlock (${fromBlock}) is ahead of latest (${latestBlock}).`);
            continue;
          }
        console.log(`Range: ${fromBlock} -> ${latestBlock} (chunk size ${CHUNK_SIZE})`);

        let newCount = 0;
        const blockTimestampCache = new Map(); // Cache block timestamps to avoid redundant calls

        try {
          for (let start = fromBlock; start <= latestBlock; start += CHUNK_SIZE) {
            const end = Math.min(start + CHUNK_SIZE - 1, latestBlock);
            process.stdout.write(`  scanning ${start}-${end}... `);

            // Get protocol-specific event names
            const protocolEventNames = Object.keys(EVENT_NAME_MAP[protocol] || {});
            
            // For WETHGateway, only include gateway-specific events
            const eventNamesToIndex = type === 'gateway' 
              ? protocolEventNames.filter(name => name.includes('ETH'))
              : protocolEventNames.filter(name => !name.includes('ETH'));
            
            // One queryFilter per event type keeps ABI decoding unambiguous and
            // makes a failure on one event type easy to isolate and retry.
            for (const eventName of eventNamesToIndex) {
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
              if (eventNamesToIndex.indexOf(eventName) < eventNamesToIndex.length - 1) {
                await new Promise(resolve => setTimeout(resolve, QUERY_DELAY));
              }

              for (const log of logs) {
                const key = `${log.transactionHash}:${log.index}`;
                if (seenKeys.has(key)) continue;

                const parsed = iface.parseLog(log);
                
                // Use protocol-specific decoder
                let wallet, asset, amount;
                if (protocol === "aave") {
                  wallet = extractAaveWallet(eventName, parsed.args);
                  ({ asset, amount } = extractAaveAssetAndAmount(eventName, parsed.args));
                } else if (protocol === "compound") {
                  wallet = extractCompoundWallet(eventName, parsed.args);
                  ({ asset, amount } = extractCompoundAssetAndAmount(eventName, parsed.args, chain);
                  // Classify Compound event based on asset type
                  eventName = classifyCompoundEvent(eventName, asset, chain);
                } else if (protocol === "morpho") {
                  wallet = extractMorphoWallet(eventName, parsed.args);
                  ({ asset, amount } = extractMorphoAssetAndAmount(eventName, parsed.args));
                } else {
                  console.error(`Unknown protocol: ${protocol}`);
                  continue;
                }

                // Map protocol-specific event name to generic event name
                const genericEventName = EVENT_NAME_MAP[protocol]?.[eventName] || eventName;

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
                  eventName: genericEventName,
                  wallet,
                  asset,
                  amount,
                  chain, // Use the chain name from config
                  protocol, // Add protocol field
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

          console.log(`Indexed ${newCount} new event(s) for ${protocol} ${type} on ${chain}. Checkpoint advanced to block ${latestBlock}.`);
          totalNewCount += newCount;
        } catch (err) {
          console.error(`Error processing ${protocol} ${type} on ${chain}: ${err.message}`);
          // Continue with other contracts even if one fails
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
