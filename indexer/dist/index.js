"use strict";
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
 *   npm run index:watch                      # backfill from checkpoint, then live-listen for new events
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexSingleTx = indexSingleTx;
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: node_path_1.default.resolve(__dirname, "../../.env") });
const ethers_1 = require("ethers");
const config_1 = require("./config");
const aaveDecoder_1 = require("./aaveDecoder");
const compoundDecoder_1 = require("./compoundDecoder");
const morphoDecoder_1 = require("./morphoDecoder");
const store_1 = require("./store");
// Helper functions for single transaction indexing
function checksum(addr) {
    if (!addr || !(0, ethers_1.isAddress)(addr))
        return addr;
    return (0, ethers_1.getAddress)(addr);
}
function decodeParsedLog(eventName, args, protocol, chain) {
    let wallet;
    let asset;
    let amount;
    if (protocol === "aave") {
        wallet = (0, aaveDecoder_1.extractWallet)(eventName, args);
        ({ asset, amount } = (0, aaveDecoder_1.extractAssetAndAmount)(eventName, args));
    }
    else if (protocol === "compound") {
        wallet = (0, compoundDecoder_1.extractWallet)(eventName, args);
        ({ asset, amount } = (0, compoundDecoder_1.extractAssetAndAmount)(eventName, args, chain));
        eventName = (0, compoundDecoder_1.classifyCompoundEvent)(eventName, asset ?? null, chain);
    }
    else if (protocol === "morpho") {
        wallet = (0, morphoDecoder_1.extractWallet)(eventName, args);
        ({ asset, amount } = (0, morphoDecoder_1.extractAssetAndAmount)(eventName, args));
    }
    else {
        return null;
    }
    const genericEventName = config_1.EVENT_NAME_MAP[protocol]?.[eventName] || eventName;
    return {
        eventName: genericEventName,
        wallet: checksum(wallet),
        asset: asset && (0, ethers_1.isAddress)(asset) ? checksum(asset) : asset,
        amount: amount != null ? String(amount) : null,
    };
}
function resolveProtocolConfig(chain, protocol) {
    const chainConfig = config_1.CHAINS.find((c) => c.name === chain);
    if (!chainConfig) {
        throw new Error(`Unknown chain: ${chain}`);
    }
    const protocolConfig = chainConfig.protocols.find((p) => p.id === protocol);
    if (!protocolConfig) {
        throw new Error(`Protocol ${protocol} is not configured for chain ${chain}`);
    }
    return { chainConfig, protocolConfig };
}
function parseAndDecodeLog(log, protocol, protocolConfig, chain) {
    const poolIface = new ethers_1.Interface(protocolConfig.abi);
    const gatewayIface = protocol === "aave" && protocolConfig.wethGatewayAbi
        ? new ethers_1.Interface(protocolConfig.wethGatewayAbi)
        : null;
    let parsed;
    try {
        parsed = poolIface.parseLog(log);
    }
    catch {
        parsed = null;
    }
    if (!parsed && gatewayIface) {
        try {
            parsed = gatewayIface.parseLog(log);
        }
        catch {
            parsed = null;
        }
    }
    if (!parsed)
        return null;
    return decodeParsedLog(parsed.name, parsed.args, protocol, chain);
}
async function indexSingleTx({ txHash, chain, protocol, sourceRpc, expectedWallet, eventName, proven = true, }) {
    const { protocolConfig } = resolveProtocolConfig(chain, protocol);
    const poolAddress = protocolConfig.poolAddress;
    const gatewayAddress = protocolConfig.wethGatewayAddress;
    if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
        throw new Error(`No pool address configured for ${protocol} on ${chain}`);
    }
    const validTargets = [poolAddress, gatewayAddress]
        .filter((a) => !!a && a !== "0x0000000000000000000000000000000000000000")
        .map((a) => a.toLowerCase());
    const provider = new ethers_1.JsonRpcProvider(sourceRpc);
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
        throw new Error(`Transaction not found on ${chain}: ${txHash}`);
    }
    if (!tx.to || !validTargets.includes(tx.to.toLowerCase())) {
        console.warn(`  ! ${txHash} was not sent to ${protocol} on ${chain} (to=${tx.to}); skipping DB backfill.`);
        return null;
    }
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
        throw new Error(`Receipt not found on ${chain}: ${txHash}`);
    }
    const block = await provider.getBlock(receipt.blockNumber);
    const timestamp = block?.timestamp ?? null;
    const expected = expectedWallet ? checksum(expectedWallet) : null;
    const decoded = [];
    for (const log of receipt.logs) {
        if (!validTargets.includes(log.address.toLowerCase()))
            continue;
        const fields = parseAndDecodeLog(log, protocol, protocolConfig, chain);
        if (!fields || !fields.wallet)
            continue;
        decoded.push({
            txHash: receipt.hash,
            logIndex: log.index,
            blockNumber: receipt.blockNumber,
            eventName: fields.eventName,
            wallet: fields.wallet,
            asset: fields.asset ?? null,
            amount: fields.amount ?? "0",
            chain,
            protocol,
            timestamp,
            proven,
        });
    }
    let candidates = decoded;
    if (expected) {
        candidates = decoded.filter((e) => e.wallet.toLowerCase() === expected.toLowerCase());
        if (candidates.length === 0) {
            console.warn(`  ! no ${protocol} log in ${txHash} matched TARGET_WALLET ${expected}; not writing a mismatched IndexedEvent.`);
            return null;
        }
    }
    if (eventName) {
        const named = candidates.filter((e) => e.eventName === eventName);
        if (named.length > 0)
            candidates = named;
    }
    if (candidates.length === 0) {
        return null;
    }
    let last = null;
    for (const row of candidates) {
        last = await (0, store_1.upsertEvent)(row);
    }
    return last;
}
// Retry configuration for RPC rate limiting
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second
const QUERY_DELAY = 500; // 500ms delay between event type queries
async function retryWithBackoff(fn, context = "") {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const isRateLimit = err?.code === -32005 || err?.message?.includes("Too Many Requests") || err?.message?.includes("429");
            if (!isRateLimit || attempt === MAX_RETRIES) {
                throw err;
            }
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
            console.log(`  ! Rate limited on ${context}, retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
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
        else if (args[i] === "--watch") {
            out.watch = true;
        }
    }
    return out;
}
function resolveFromBlock({ cliFromBlock, checkpointBlock, startBlockEnv, latestBlock, }) {
    if (cliFromBlock != null)
        return cliFromBlock; // explicit override wins
    if (checkpointBlock != null)
        return checkpointBlock + 1; // normal resume path
    if (startBlockEnv)
        return Number(startBlockEnv); // first-ever run, configured start
    return latestBlock; // first-ever run, no config: start from "now"
}
async function runOnce(cli) {
    const seenKeys = await (0, store_1.getSeenKeys)();
    let totalNewCount = 0;
    try {
        // Process each chain independently
        for (const chainConfig of config_1.CHAINS) {
            const { name: chain, rpcEnvVar, protocols } = chainConfig;
            const rpcUrl = process.env[rpcEnvVar];
            if (!rpcUrl) {
                console.log(`Skipping ${chain}: missing ${rpcEnvVar} in .env`);
                continue;
            }
            console.log(`\n=== Processing chain: ${chain} ===`);
            const provider = new ethers_1.JsonRpcProvider(rpcUrl);
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
                    type: "pool",
                    address: contractAddress,
                    abi,
                });
                if (protocol === "aave" &&
                    wethGatewayAddress &&
                    wethGatewayAddress !== "0x0000000000000000000000000000000000000000") {
                    contractsToIndex.push({
                        type: "gateway",
                        address: wethGatewayAddress,
                        abi: wethGatewayAbi ?? [],
                    });
                    console.log(`Also indexing WETHGateway: ${wethGatewayAddress}`);
                }
                for (const contractConfig of contractsToIndex) {
                    const { type, address: contractAddr, abi: contractAbi } = contractConfig;
                    console.log(`Indexing ${protocol} ${type} ${contractAddr} on ${chain}`);
                    const iface = new ethers_1.Interface(contractAbi);
                    const contract = new ethers_1.Contract(contractAddr, contractAbi, provider);
                    const checkpoint = await (0, store_1.loadCheckpoint)(chain, contractAddr);
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
                    console.log(`Range: ${fromBlock} -> ${latestBlock} (chunk size ${config_1.CHUNK_SIZE})`);
                    let newCount = 0;
                    const blockTimestampCache = new Map(); // Cache block timestamps to avoid redundant calls
                    try {
                        for (let start = fromBlock; start <= latestBlock; start += config_1.CHUNK_SIZE) {
                            const end = Math.min(start + config_1.CHUNK_SIZE - 1, latestBlock);
                            process.stdout.write(`  scanning ${start}-${end}... `);
                            // Get protocol-specific event names
                            const protocolEventNames = Object.keys(config_1.EVENT_NAME_MAP[protocol] || {});
                            // For WETHGateway, only include gateway-specific events
                            const eventNamesToIndex = type === "gateway"
                                ? protocolEventNames.filter((name) => name.includes("ETH"))
                                : protocolEventNames.filter((name) => !name.includes("ETH"));
                            // One queryFilter per event type keeps ABI decoding unambiguous and
                            // makes a failure on one event type easy to isolate and retry.
                            for (let eventName of eventNamesToIndex) {
                                let logs;
                                try {
                                    logs = await retryWithBackoff(() => contract.queryFilter(contract.filters[eventName](), start, end), `${eventName} (${start}-${end})`);
                                }
                                catch (err) {
                                    console.error(`\n  ! queryFilter(${eventName}, ${start}, ${end}) failed after retries: ${err.message}`);
                                    console.error(`  Consider lowering INDEXER_CHUNK_SIZE (current: ${config_1.CHUNK_SIZE}) and re-running.`);
                                    throw err;
                                }
                                // Small delay between event types to avoid rate limiting
                                if (eventNamesToIndex.indexOf(eventName) < eventNamesToIndex.length - 1) {
                                    await new Promise((resolve) => setTimeout(resolve, QUERY_DELAY));
                                }
                                for (const log of logs) {
                                    const key = `${log.transactionHash}:${log.index}`;
                                    if (seenKeys.has(key))
                                        continue;
                                    const parsed = iface.parseLog(log);
                                    if (!parsed)
                                        continue;
                                    // CRITICAL: Validate that transaction targets the protocol contract directly
                                    // This prevents relayed/gas-station transactions from being added to the queue
                                    // since the contract requires direct protocol calls for trustless decoding
                                    const tx = await retryWithBackoff(() => provider.getTransaction(log.transactionHash), `getTransaction(${log.transactionHash})`);
                                    if (!tx || !tx.to)
                                        continue;
                                    // Build valid targets for this protocol
                                    // For Aave, accept both Pool and WETHGateway as valid entrypoints
                                    // For other protocols, only accept the direct contract address
                                    const validTargetsForProtocol = protocol === "aave" &&
                                        wethGatewayAddress &&
                                        wethGatewayAddress !== "0x0000000000000000000000000000000000000000"
                                        ? [contractAddr, wethGatewayAddress].map((a) => a.toLowerCase())
                                        : [contractAddr.toLowerCase()];
                                    if (!validTargetsForProtocol.includes(tx.to.toLowerCase())) {
                                        console.log(`  → Skipping relayed tx ${log.transactionHash.substring(0, 10)}... (to: ${tx.to}, expected one of: ${validTargetsForProtocol.join(", ")})`);
                                        continue;
                                    }
                                    // Extract wallet, asset, and amount from event
                                    const decoded = decodeParsedLog(eventName, parsed.args, protocol, chain);
                                    if (!decoded || !decoded.wallet)
                                        continue;
                                    // Get block timestamp (cached per block number)
                                    let timestamp;
                                    if (blockTimestampCache.has(log.blockNumber)) {
                                        timestamp = blockTimestampCache.get(log.blockNumber);
                                    }
                                    else {
                                        const block = await retryWithBackoff(() => provider.getBlock(log.blockNumber), `getBlock(${log.blockNumber})`);
                                        timestamp = block.timestamp;
                                        blockTimestampCache.set(log.blockNumber, timestamp);
                                    }
                                    await (0, store_1.saveEvent)({
                                        txHash: log.transactionHash,
                                        logIndex: log.index,
                                        blockNumber: log.blockNumber,
                                        eventName: decoded.eventName,
                                        wallet: decoded.wallet,
                                        asset: decoded.asset ?? null,
                                        amount: decoded.amount ?? "0",
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
                        await (0, store_1.saveCheckpoint)(chain, contractAddress, latestBlock);
                        console.log(`Indexed ${newCount} new event(s) for ${protocol} ${type} on ${chain}. Checkpoint advanced to block ${latestBlock}.`);
                        totalNewCount += newCount;
                    }
                    catch (err) {
                        console.error(`Error processing ${protocol} ${type} on ${chain}: ${err.message}`);
                        // Continue with other contracts even if one fails
                    }
                }
            }
        }
        console.log(`\n=== Total: ${totalNewCount} new event(s) indexed across all chains ===`);
    }
    catch (err) {
        console.error(`Fatal error in runOnce: ${err.message}`);
    }
    return totalNewCount;
}
async function handleLiveLog(log, contract, protocol, chain, emittingContractAddr, poolAddress) {
    try {
        // Validate that transaction targets the protocol contract directly
        const provider = contract.runner;
        const tx = await provider.getTransaction(log.transactionHash);
        if (!tx || !tx.to)
            return;
        // Build valid targets for this protocol
        // For Aave pool events: accept pool address
        // For Aave gateway events: accept both gateway and pool addresses
        // For other protocols: only accept the direct contract address
        const validTargetsForProtocol = protocol === "aave" &&
            poolAddress &&
            poolAddress !== "0x0000000000000000000000000000000000000000"
            ? [emittingContractAddr, poolAddress].map((a) => a.toLowerCase())
            : [emittingContractAddr.toLowerCase()];
        if (!validTargetsForProtocol.includes(tx.to.toLowerCase())) {
            console.log(`  → Skipping relayed tx ${log.transactionHash.substring(0, 10)}... (to: ${tx.to}, expected one of: ${validTargetsForProtocol.join(", ")})`);
            return;
        }
        // Parse the log
        const parsed = contract.interface.parseLog(log);
        if (!parsed)
            return;
        // Decode the log
        const decoded = decodeParsedLog(parsed.name, parsed.args, protocol, chain);
        if (!decoded || !decoded.wallet)
            return;
        // Get block timestamp
        const block = await provider.getBlock(log.blockNumber);
        const timestamp = block?.timestamp ?? null;
        // Upsert the event
        await (0, store_1.upsertEvent)({
            txHash: log.transactionHash,
            logIndex: log.index,
            blockNumber: log.blockNumber,
            eventName: decoded.eventName,
            wallet: decoded.wallet,
            asset: decoded.asset ?? null,
            amount: decoded.amount ?? "0",
            chain,
            protocol,
            timestamp,
            proven: false,
        });
        // Advance checkpoint (use pool address for checkpoint regardless of which contract emitted the event)
        const checkpointAddress = poolAddress || emittingContractAddr;
        await (0, store_1.saveCheckpoint)(chain, checkpointAddress, log.blockNumber);
        console.log(`  → Live event: ${decoded.eventName} for ${decoded.wallet} in tx ${log.transactionHash.substring(0, 10)}...`);
    }
    catch (err) {
        console.error(`  ! Error handling live log: ${err.message}`);
    }
}
async function startLiveListeners() {
    const contracts = [];
    for (const chainConfig of config_1.CHAINS) {
        const { name: chain, rpcEnvVar, protocols } = chainConfig;
        const rpcUrl = process.env[rpcEnvVar];
        if (!rpcUrl) {
            console.log(`Skipping ${chain} for live listening: missing ${rpcEnvVar} in .env`);
            continue;
        }
        console.log(`\n=== Setting up live listeners for chain: ${chain} ===`);
        const provider = new ethers_1.JsonRpcProvider(rpcUrl);
        for (const protocolConfig of protocols) {
            const { id: protocol, poolAddress: contractAddress, abi, wethGatewayAddress, wethGatewayAbi } = protocolConfig;
            if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
                console.log(`Skipping ${protocol} on ${chain}: pool address not configured`);
                continue;
            }
            console.log(`Setting up listeners for ${protocol} (${contractAddress})`);
            // Setup pool contract listeners
            const poolContract = new ethers_1.Contract(contractAddress, abi, provider);
            contracts.push(poolContract);
            const protocolEventNames = Object.keys(config_1.EVENT_NAME_MAP[protocol] || {});
            const poolEventNames = protocolEventNames.filter((name) => !name.includes("ETH"));
            for (const eventName of poolEventNames) {
                poolContract.on(eventName, (...args) => {
                    const log = args[args.length - 1];
                    handleLiveLog(log, poolContract, protocol, chain, contractAddress, wethGatewayAddress);
                });
                console.log(`  → Listening for ${eventName} on pool`);
            }
            // Setup WETHGateway listeners for Aave
            if (protocol === "aave" &&
                wethGatewayAddress &&
                wethGatewayAddress !== "0x0000000000000000000000000000000000000000" &&
                wethGatewayAbi) {
                const gatewayContract = new ethers_1.Contract(wethGatewayAddress, wethGatewayAbi, provider);
                contracts.push(gatewayContract);
                const gatewayEventNames = protocolEventNames.filter((name) => name.includes("ETH"));
                for (const eventName of gatewayEventNames) {
                    gatewayContract.on(eventName, (...args) => {
                        const log = args[args.length - 1];
                        handleLiveLog(log, gatewayContract, protocol, chain, wethGatewayAddress, contractAddress);
                    });
                    console.log(`  → Listening for ${eventName} on WETHGateway`);
                }
            }
        }
    }
    return contracts;
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
        if (chainEvents.length > 5)
            console.log(`    ... and ${chainEvents.length - 5} more`);
    }
    console.log(`\nNote: batch cap is 10 queries per continuity proof per chain — batch in groups of <=10 per chain.`);
}
async function main() {
    const cli = parseArgs();
    if (cli.watch) {
        console.log("Backfilling from last checkpoint...");
        await runOnce(cli);
        const contracts = await startLiveListeners();
        console.log("\nLive-listening for new events. Ctrl+C to stop.");
        let shuttingDown = false;
        const shutdown = () => {
            if (shuttingDown)
                return;
            shuttingDown = true;
            console.log("\nShutdown requested, stopping listeners...");
            Promise.all(contracts.map((c) => c.removeAllListeners()))
                .then(() => (0, store_1.disconnect)())
                .finally(() => process.exit(0));
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);
        return;
    }
    await runOnce(cli);
    const eventStore = await (0, store_1.loadEvents)();
    printSummary(eventStore);
    await (0, store_1.disconnect)();
}
if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=index.js.map