/**
 * generateAndSubmitProof.js
 *
 * Single-transaction demo: prove SOURCE_TX_HASH (or a CLI hash) on CC3 Testnet
 * via Attestcoin and credit TARGET_WALLET on CreditScoreMVP.
 *
 * Usage:
 *   npm run prove
 *   npm run prove -- 0xSourceTxHash
 *
 * If SOURCE_TX_HASH is unset, uses the oldest unproven indexer event.
 */

require("dotenv").config();
const { JsonRpcProvider } = require("ethers");
const { proveTransaction } = require("./lib/proveTransaction");
const { EVENT_TYPE_INDEX, EVENT_TYPE_NAMES } = require("./lib/eventTypes");
const {
  loadEventByTxHash,
  loadUnprovenEvents,
  markProven,
  disconnect,
} = require("../indexer/src/store");
const { indexSingleTx } = require("../indexer/src/index");

const AAVE_SELECTORS = {
  "0x617ba037": "Supply",
  "0xa415bcad": "Borrow",
  "0x573ade81": "Repay",
  "0x69328dec": "Withdraw",
  "0x00a718a9": "LiquidationCall",
  "0x02c205f0": "Supply",
  "0xee3e210b": "Repay",
  "0x2dad97d4": "Repay",
  "0x474cf53d": "Supply",
  "0x80500d20": "Withdraw",
};

const COMPOUND_SELECTORS = {
  "0xf2b9fdb8": "Supply",
  "0xf3fef3a3": "Withdraw",
  "0xc3cecfd2": "LiquidationCall",
};

const MORPHO_SELECTORS = {
  "0xa99aad89": "Supply",
  "0x5c2bea49": "Withdraw",
  "0x50d8cd4b": "Borrow",
  "0x20b76e81": "Repay",
  "0xd8eabcb8": "LiquidationCall",
};

function getRpcForChain(chain) {
  const envVar = `${chain.toUpperCase().replace(/-/g, "_")}_RPC`;
  const rpcUrl = process.env[envVar];
  if (!rpcUrl) {
    throw new Error(`Missing ${envVar} in .env for chain ${chain}`);
  }
  return rpcUrl;
}

function eventNameFromCalldata(data, protocol) {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  if (protocol === "compound") return COMPOUND_SELECTORS[selector] || null;
  if (protocol === "morpho") return MORPHO_SELECTORS[selector] || null;
  return AAVE_SELECTORS[selector] || null;
}

async function resolveSource({ sourceTxHash, chain, protocol }) {
  if (sourceTxHash) {
    const indexed = await loadEventByTxHash(sourceTxHash);
    return { indexed, sourceTxHash };
  }

  const queued = await loadUnprovenEvents(1, chain, protocol === "aave" ? null : protocol);
  if (queued.length > 0) {
    console.log(
      `SOURCE_TX_HASH unset — using oldest unproven indexed event ${queued[0].txHash}`
    );
    return { indexed: queued[0], sourceTxHash: queued[0].txHash };
  }

  throw new Error(
    "Missing SOURCE_TX_HASH in .env (or pass a tx hash: npm run prove -- 0x...). Indexer has no unproven events either."
  );
}

async function main() {
  const {
    CC3_TESTNET_RPC,
    PROVER_API_URL,
    PRIVATE_KEY,
    CONTRACT_ADDRESS,
    SOURCE_TX_HASH,
    TARGET_WALLET,
    EVENT_NAME,
    CHAIN,
    PROTOCOL,
  } = process.env;

  if (!CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error(
      "Missing required .env values (CC3_TESTNET_RPC, PRIVATE_KEY, CONTRACT_ADDRESS) — check .env.example."
    );
  }

  const chain = (CHAIN || "sepolia").toLowerCase();
  const protocolHint = (PROTOCOL || "aave").toLowerCase();
  const { indexed, sourceTxHash } = await resolveSource({
    sourceTxHash: process.argv[2] || SOURCE_TX_HASH,
    chain,
    protocol: protocolHint,
  });

  const protocol = (indexed?.protocol || protocolHint).toLowerCase();
  const sourceRpc = getRpcForChain(indexed?.chain || chain);
  const eventChain = indexed?.chain || chain;

  let eventName = EVENT_NAME || indexed?.eventName;
  if (!eventName) {
    const sourceProvider = new JsonRpcProvider(sourceRpc);
    const tx = await sourceProvider.getTransaction(sourceTxHash);
    if (!tx) {
      throw new Error(`Transaction not found on ${eventChain}: ${sourceTxHash}`);
    }
    eventName = eventNameFromCalldata(tx.data, protocol);
  }

  const eventType = EVENT_TYPE_INDEX[eventName];
  if (eventType === undefined) {
    throw new Error(
      `Could not resolve event type for ${sourceTxHash}. Set EVENT_NAME in .env (Supply|Borrow|Repay|Withdraw|LiquidationCall) or index the tx first.`
    );
  }

  const targetWallet = TARGET_WALLET || indexed?.wallet;
  if (!targetWallet) {
    throw new Error("Set TARGET_WALLET in .env (or index the tx so the wallet is known).");
  }

  const proverApiUrl = PROVER_API_URL || "https://prover.cc3-testnet.creditcoin.network";

  console.log("Proving loan event");
  console.log(`  source tx: ${sourceTxHash}`);
  console.log(`  chain:     ${eventChain}`);
  console.log(`  protocol:  ${protocol}`);
  console.log(`  event:     ${EVENT_TYPE_NAMES[eventType]} (${eventType})`);
  console.log(`  wallet:    ${targetWallet}`);
  console.log(`  contract:  ${CONTRACT_ADDRESS}`);
  console.log("");

  const result = await proveTransaction({
    sourceTxHash,
    targetWallet,
    eventType,
    sourceRpc,
    chain: eventChain,
    protocol,
    cc3TestnetRpc: CC3_TESTNET_RPC,
    proverApiUrl,
    privateKey: PRIVATE_KEY,
    contractAddress: CONTRACT_ADDRESS,
  });

  if (indexed) {
    await markProven(sourceTxHash).catch(() => {});
  } else {
    try {
      const row = await indexSingleTx({
        txHash: sourceTxHash,
        chain: eventChain,
        protocol,
        sourceRpc,
        expectedWallet: targetWallet,
        eventName,
        proven: true,
      });
      if (row) {
        console.log(
          `  backfilled IndexedEvent ${row.eventName} wallet=${row.wallet} logIndex=${row.logIndex}`
        );
      }
    } catch (err) {
      console.warn(`  ! Postgres backfill failed: ${err.message}`);
    }
  }

  if (result.alreadyProven) {
    console.log(`Already proven on-chain. Score: ${result.scoreBefore}`);
  } else {
    console.log(`Score before: ${result.scoreBefore}`);
    console.log(`Score after:  ${result.scoreAfter}`);
    if (result.scoreAfter > result.scoreBefore) {
      console.log("");
      console.log("✅ SUCCESS — score increased. The source transaction was cryptographically");
      console.log("verified via Attestcoin and reflected on Creditcoin.");
    } else {
      console.log("");
      console.log("Submitted on-chain, but score did not increase (check event weights / type).");
    }
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => disconnect().catch(() => {}));
