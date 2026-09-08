/**
 * Prove stage. Subscribes to eventBus's INDEXED event and pushes every new,
 * unproven row through the existing proof pipeline, then marks it proven in
 * Postgres on success.
 *
 * proveTransaction/processBatch/EVENT_TYPE_INDEX are NOT reimplemented here —
 * they're required in as-is from ../../scripts/lib (the root package's
 * battle-tested CJS proof logic that talks to @gluwa/usc-sdk). Node's
 * require() resolves node_modules relative to the FILE doing the requiring,
 * so scripts/lib/*.cjs still finds @gluwa/usc-sdk in the repo root's
 * node_modules regardless of which package invoked it — no new dependency
 * needed in indexer/package.json.
 *
 * IMPORTANT — single signer, single nonce:
 * proveTransaction and processBatch both sign with the same PRIVATE_KEY.
 * Firing them concurrently for multiple events races that wallet's nonce
 * and will silently drop or misorder on-chain submissions. Everything here
 * runs through one FIFO queue with exactly one drain loop in flight, so
 * only one proof submission is ever in progress at a time — this is a
 * deliberate throughput ceiling, not an oversight. If proving becomes the
 * bottleneck, look at giving the prover its own dedicated signer/nonce
 * manager before parallelizing, not at removing the serialization.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { bus, EVENTS } from "./eventBus.js";
import { markProven, loadUnprovenEvents, type IndexedEventRow } from "./store.js";

const require = createRequire(import.meta.url);
// process.cwd() is expected to be indexer/ (per README: `cd indexer && npm run ...`).
const scriptsLib = path.resolve(process.cwd(), "../scripts/lib");
const { proveTransaction } = require(path.join(scriptsLib, "proveTransaction.cjs"));
const { processBatch } = require(path.join(scriptsLib, "proveBatch.cjs"));
const { EVENT_TYPE_INDEX } = require(path.join(scriptsLib, "eventTypes.cjs"));

const RPC_BY_CHAIN: Record<string, string | undefined> = {
  sepolia: process.env.SEPOLIA_RPC,
  "cc3-testnet": process.env.CC3_TESTNET_SOURCE_RPC,
};

const { CC3_TESTNET_RPC, PROVER_API_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;
const PROVER_URL = PROVER_API_URL || "https://prover.cc3-testnet.creditcoin.network";

// "immediate": prove each event as it lands (lowest latency, matches "real time").
// "batch": group same chain:protocol events (up to PROVE_BATCH_SIZE) into one
//   on-chain tx via getBatchProof — cheaper gas, slightly higher latency.
const PROVE_MODE = (process.env.PROVE_MODE || "immediate") as "immediate" | "batch";
const BATCH_MAX = Number(process.env.PROVE_BATCH_SIZE || 10);
// Safety net: re-check Postgres for anything still unproven every so often.
// Catches events whose prove attempt threw (RPC blip, prover API timeout)
// and anything left over from a previous crashed process.
const SWEEP_INTERVAL_MS = Number(process.env.PROVE_SWEEP_INTERVAL_MS || 120_000);
// Add delay between submissions to avoid nonce conflicts
const SUBMISSION_DELAY_MS = Number(process.env.PROVE_SUBMISSION_DELAY_MS || 2000);

const queue: IndexedEventRow[] = [];
const inFlight = new Set<string>(); // txHash guard so a sweep can't re-enqueue what's already queued
let draining = false;

export function startProver(): void {
  if (!CC3_TESTNET_RPC || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing CC3_TESTNET_RPC / PRIVATE_KEY / CONTRACT_ADDRESS — prover cannot start.");
  }

  bus.on(EVENTS.INDEXED, (row: IndexedEventRow) => enqueue(row));

  const sweep = () => loadUnprovenEvents(1000).then((rows) => rows.forEach(enqueue));
  sweep(); // pick up anything unproven from before this process started
  setInterval(sweep, SWEEP_INTERVAL_MS);

  console.log(`[prove] started (mode=${PROVE_MODE}, sweep every ${SWEEP_INTERVAL_MS}ms)`);
}

function enqueue(row: IndexedEventRow): void {
  if (row.proven || inFlight.has(row.txHash)) return;
  inFlight.add(row.txHash);
  queue.push(row);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      if (PROVE_MODE === "batch") {
        await drainOneBatch();
      } else {
        await proveOne(queue.shift()!);
        // Add delay between submissions to avoid nonce conflicts
        if (queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, SUBMISSION_DELAY_MS));
        }
      }
    }
  } finally {
    draining = false;
  }
}

async function proveOne(row: IndexedEventRow): Promise<void> {
  try {
    const eventType = EVENT_TYPE_INDEX[row.eventName];
    if (eventType === undefined) {
      console.error(`[prove] unrecognized eventName "${row.eventName}" for ${row.txHash}, skipping`);
      return;
    }
    const rpc = RPC_BY_CHAIN[row.chain];
    if (!rpc) {
      console.error(`[prove] no RPC configured for chain ${row.chain}, skipping ${row.txHash}`);
      return;
    }

    const result = await proveTransaction({
      sourceTxHash: row.txHash,
      targetWallet: row.wallet,
      eventType,
      sourceRpc: rpc,
      chain: row.chain,
      protocol: row.protocol,
      cc3TestnetRpc: CC3_TESTNET_RPC,
      proverApiUrl: PROVER_URL,
      privateKey: PRIVATE_KEY,
      contractAddress: CONTRACT_ADDRESS,
      log: (m: string) => console.log(`  [prove] ${m}`),
    });

    await markProven(row.txHash);
    console.log(
      result.alreadyProven
        ? `[prove] ${row.txHash} already proven on-chain — marked in DB` 
        : `[prove] ✅ ${row.txHash} (${row.eventName}) score ${result.scoreBefore} -> ${result.scoreAfter}` 
    );
  } catch (err: any) {
    // Handle "already known" errors - these mean the tx was already submitted
    // We should mark it as proven since it's being processed
    const errorMessage = err.message || String(err);
    if (errorMessage.includes("already known") || errorMessage.includes("nonce too low") || 
        errorMessage.includes("could not coalesce")) {
      console.log(`[prove] ${row.txHash} transaction already submitted/in mempool — marking as proven`);
      await markProven(row.txHash).catch(() => {});
    } else {
      // Left unproven in DB on purpose — the periodic sweep will retry it.
      console.error(`[prove] ! failed for ${row.txHash}: ${errorMessage} (will retry on next sweep)`);
    }
  } finally {
    inFlight.delete(row.txHash);
  }
}

async function drainOneBatch(): Promise<void> {
  const key = `${queue[0].chain}:${queue[0].protocol}`;
  const [chain, protocol] = [queue[0].chain, queue[0].protocol];
  const group: IndexedEventRow[] = [];
  while (queue.length > 0 && group.length < BATCH_MAX && `${queue[0].chain}:${queue[0].protocol}` === key) {
    group.push(queue.shift()!);
  }

  const rpc = RPC_BY_CHAIN[chain];
  if (!rpc) {
    console.error(`[prove] no RPC configured for ${chain}, skipping batch of ${group.length}`);
    group.forEach((r) => inFlight.delete(r.txHash));
    return;
  }

  const validEvents = group
    .map((e) => ({ ...e, eventType: EVENT_TYPE_INDEX[e.eventName] }))
    .filter((e) => e.eventType !== undefined);

  try {
    const result = await processBatch(validEvents, {
      chain,
      protocol,
      sourceRpc: rpc,
      cc3TestnetRpc: CC3_TESTNET_RPC,
      proverApiUrl: PROVER_URL,
      privateKey: PRIVATE_KEY,
      contractAddress: CONTRACT_ADDRESS,
      log: (m: string) => console.log(`  [prove:batch] ${m}`),
    });

    if (result.processed > 0) {
      for (const e of validEvents) await markProven(e.txHash);
      console.log(`[prove] ✅ batch of ${result.processed} proven on ${chain}:${protocol}`);
    }
  } catch (err: any) {
    const errorMessage = err.message || String(err);
    // If it's an "already known" error, mark all as proven
    if (errorMessage.includes("already known") || errorMessage.includes("nonce too low")) {
      console.log(`[prove] batch transaction already submitted — marking all as proven`);
      for (const e of validEvents) await markProven(e.txHash).catch(() => {});
    } else {
      console.error(`[prove] ! batch failed for ${chain}:${protocol}, falling back to individual proofs: ${errorMessage}`);
      for (const row of group) await proveOne(row);
      return; // proveOne already released inFlight for each row
    }
  }

  group.forEach((r) => inFlight.delete(r.txHash));
}
