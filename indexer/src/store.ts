import path from "node:path";
import dotenv from "dotenv";
import { Temporal } from "@js-temporal/polyfill";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../db/.env"), override: false });

import { db } from "creditscore-db";
import { POINTS_BY_EVENT } from "./config.js";
import { emitIndexed } from "./eventBus.js";
import { resolveTokenMeta, humanAmount } from "./tokenMeta.js";
import { scoreWithAI, scoreWithAIBatch } from "./aiScorer.js";
import { computeFicoScore, computeUtilizationDrift } from "./scoreModel.js";
import { getPriceUSD } from "./priceOracle.js";
import { BatchQueue } from "./batchQueue.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured in .env");
}

export interface Checkpoint {
  lastIndexedBlock: number | null;
}

// Shared row shape — was duplicated inline on every function below.
export interface IndexedEventRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  eventName: string;
  wallet: string;
  asset: string | null;
  amount: string;
  chain: string;
  protocol: string;
  timestamp: number | null;
  proven: boolean;
  createdAt: Date;
  id: number;
}

export type NewIndexedEvent = Omit <
  {
    txHash: string;
    logIndex: number;
    blockNumber: number;
    eventName: string;
    wallet: string;
    asset: string | null;
    amount: string;
    chain: string;
    protocol: string;
    timestamp: number | null;
    proven: boolean;
  },
  "id" | "createdAt"
>;

export async function loadCheckpoint(chain: string, contractAddress: string): Promise<Checkpoint> {
  const checkpoint = await db.orm.public.IndexerCheckpoint.where({ chain, contractAddress }).first();
  return checkpoint || { lastIndexedBlock: null };
}

export async function saveCheckpoint(
  chain: string,
  contractAddress: string,
  lastIndexedBlock: number
): Promise<void> {
  await db.orm.public.IndexerCheckpoint.upsert({
    conflictOn: { chain, contractAddress },
    create: {
      chain,
      contractAddress,
      lastIndexedBlock,
      updatedAt: Temporal.Now.instant(),
    },
    update: {
      lastIndexedBlock,
      updatedAt: Temporal.Now.instant(),
    },
  });
}

export async function loadEvents(): Promise<IndexedEventRow[]> {
  const events = await db.orm.public.IndexedEvent.orderBy([(e: any) => e.blockNumber.asc(), (e: any) => e.logIndex.asc()]).all();
  return events;
}

export async function saveEvent(eventData: NewIndexedEvent): Promise<IndexedEventRow> {
  const event = await db.orm.public.IndexedEvent.create(eventData);
  // Enqueue for batched AI scoring instead of scoring inline — see
  // aiScoreQueue below. Non-blocking: indexing doesn't wait on Gemini.
  aiScoreQueue.enqueue(eventData);
  // New row -> hand it to the prover. Every insertion path (live watch,
  // one-shot `npm run index`, backfill) goes through here or upsertEvent,
  // so this is the single choke point that feeds the prove stage.
  if (!event.proven) emitIndexed(event);
  return event;
}

export async function upsertEvent(eventData: NewIndexedEvent): Promise<IndexedEventRow> {
  const { txHash, logIndex, ...rest } = eventData;
  
  // Check if event already exists before upsert
  const existing = await db.orm.public.IndexedEvent.where({ txHash, logIndex }).first();

  const event = await db.orm.public.IndexedEvent.upsert({
    conflictOn: { txHash, logIndex },
    create: eventData,
    update: rest,
  });

  // Only award points / notify the prover for new events (when existing was null)
  if (!existing) {
    aiScoreQueue.enqueue(eventData);
    if (!event.proven) emitIndexed(event);
  }

  return event;
}

export async function loadUnprovenEvents(
  limit = 10,
  chain: string | null = null,
  protocol: string | null = null
): Promise<IndexedEventRow[]> {
  const query = db.orm.public.IndexedEvent.where((e: any) => e.proven.eq(false));
  if (chain) {
    query.where((e: any) => e.chain.eq(chain));
  }
  if (protocol) {
    query.where((e: any) => e.protocol.eq(protocol));
  }

  return (query.orderBy([(e: any) => e.blockNumber.asc(), (e: any) => e.logIndex.asc()]) as any).limit(limit).all();
}

export async function loadEventByTxHash(txHash: string | null | undefined): Promise<IndexedEventRow | null> {
  if (!txHash) return null;
  return db.orm.public.IndexedEvent.where((e: any) => 
    e.txHash.ilike(txHash)
  ).first();
}

export async function markProven(txHash: string): Promise<void> {
  await db.orm.public.IndexedEvent.where((e: any) => e.txHash.eq(txHash)).update({ proven: true });
}

export async function getSeenKeys(): Promise<Set<string>> {
  const events = await db.orm.public.IndexedEvent.select("txHash", "logIndex").all() as any[];
  return new Set(events.map((e: any) => `${e.txHash}:${e.logIndex}`));
}

export async function disconnect(): Promise<void> {
  // Prisma Next db client doesn't require explicit disconnect
  // This function is kept for API compatibility
}

/** Scores and applies a single event immediately. Kept for manual/one-off
 *  use (e.g. a backfill script); the live indexer uses awardPointsAIBatch
 *  via aiScoreQueue instead — see saveEvent/upsertEvent above. */
export async function awardPointsAI(eventData: NewIndexedEvent): Promise<void> {
  if (!eventData.asset) return;
  await awardPointsAIBatch([eventData]);
}

/**
 * Scores a batch of events in one Gemini call, then applies each result to
 * its wallet's rawScore/points sequentially (not Promise.all) — if two
 * events in the same batch are for the same wallet, each must see the
 * previous one's updated rawScore rather than both reading the same stale
 * prior value.
 */
export async function awardPointsAIBatch(events: NewIndexedEvent[]): Promise<void> {
  const scorable = events.filter((e) => e.asset);
  if (scorable.length === 0) return;

  const metas = await Promise.all(
    scorable.map((e) => resolveTokenMeta(e.chain, e.asset!))
  );
  const results = await scoreWithAIBatch(
    scorable.map((e, i) => ({
      eventName: e.eventName,
      protocol: e.protocol,
      symbol: metas[i].symbol,
      humanAmount: humanAmount(e.amount, metas[i].decimals),
    }))
  );

  for (let i = 0; i < scorable.length; i++) {
    const eventData = scorable[i];
    const result = results[i];
    const meta = metas[i];

    const existingWallet = await db.orm.public.RegisteredWallet.where((w: any) =>
      w.wallet.ilike(eventData.wallet)
    ).first();

    // --- P (Payment History): unchanged AI-judged accumulator ---------
    const priorRaw = (existingWallet as any)?.rawScore ?? 0;
    const newRaw = priorRaw + result.rawDelta;

    // --- U (Utilization): continuous checkpoint-accumulator -----------
    const now = eventData.timestamp ?? Math.floor(Date.now() / 1000);
    const priorOutstanding = (existingWallet as any)?.netOutstandingUSD ?? 0;
    const priorUDrift = (existingWallet as any)?.uDrift ?? 0;
    // A wallet with no prior checkpoint (new registration, or pre-migration
    // row with lastCheckpointAt=0) has no elapsed time to settle yet —
    // anchor the checkpoint at `now` instead of drifting from the epoch.
    const lastCheckpointAt = (existingWallet as any)?.lastCheckpointAt || now;

    // 1. Settle drift up to *now* using the balance that existed BEFORE
    //    this event (checkpoint-accumulator correctness rule — see
    //    scoreModel.ts computeUtilizationDrift docs).
    const settledUDrift = computeUtilizationDrift(priorUDrift, priorOutstanding, lastCheckpointAt, now);

    // 2. THEN apply this event's effect on the debt balance itself.
    const priceUSD = getPriceUSD(eventData.chain, eventData.asset!, meta.symbol);
    const amountUSD = Number(humanAmount(eventData.amount, meta.decimals)) * priceUSD;

    let newOutstanding = priorOutstanding;
    if (eventData.eventName === "Borrow") {
      newOutstanding = priorOutstanding + amountUSD;
    } else if (eventData.eventName === "Repay") {
      newOutstanding = Math.max(0, priorOutstanding - amountUSD);
    } else if (eventData.eventName === "LiquidationCall") {
      // The liquidator forcibly clears the debt on-chain; the one-time
      // severity penalty for *how* it happened still comes through P via
      // result.rawDelta (AI-scored / POINTS_BY_EVENT fallback).
      newOutstanding = 0;
    }
    // Supply/Withdraw don't affect outstanding debt.

    const newDisplay = computeFicoScore(newRaw, settledUDrift);

    if (existingWallet) {
      await db.orm.public.RegisteredWallet.where((w: any) =>
        w.wallet.ilike(eventData.wallet)
      ).update({
        rawScore: newRaw,
        netOutstandingUSD: newOutstanding,
        uDrift: settledUDrift,
        lastCheckpointAt: now,
        points: Math.round(newDisplay),
      });
    } else {
      // Create wallet if it doesn't exist
      await db.orm.public.RegisteredWallet.create({
        wallet: eventData.wallet,
        rawScore: newRaw,
        netOutstandingUSD: newOutstanding,
        uDrift: settledUDrift,
        lastCheckpointAt: now,
        points: Math.round(newDisplay),
      });
    }

    await (db.orm.public as any).AiScoreLog.create({
      wallet: eventData.wallet,
      eventName: eventData.eventName,
      importance: result.importance,
      reasoning: result.reasoning,
      rawDelta: result.rawDelta,
      newRawScore: newRaw,
      newDisplayScore: newDisplay,
    });
  }
}

// Buffers new events for up to 60s (or 10 events, whichever comes first),
// then scores the whole batch in one Gemini call via awardPointsAIBatch.
// maxBatchSize mirrors PROVE_BATCH_SIZE's default in prove.ts, for the
// same reason — bound the blast radius of one call.
export const aiScoreQueue = new BatchQueue<NewIndexedEvent>(60_000, 10, awardPointsAIBatch);

/** @deprecated Use awardPointsAI instead. Kept for API compatibility. */
export async function awardPoints(wallet: string, eventName: string): Promise<void> {
  const points = POINTS_BY_EVENT[eventName];
  if (points === undefined || points === 0) return;

  const existingWallet = await db.orm.public.RegisteredWallet.where((w: any) =>
    w.wallet.ilike(wallet)
  ).first();

  if (existingWallet) {
    await db.orm.public.RegisteredWallet.where((w: any) =>
      w.wallet.ilike(wallet)
    ).update({ points: existingWallet.points + points });
  }
}