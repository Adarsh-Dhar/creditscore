import path from "node:path";
import dotenv from "dotenv";
import { Temporal } from "@js-temporal/polyfill";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../db/.env"), override: false });

import { db } from "creditscore-db";
import { POINTS_BY_EVENT } from "./config.js";
import { emitIndexed } from "./eventBus.js";
import { resolveTokenMeta, humanAmount } from "./tokenMeta.js";
import { scoreWithAI } from "./aiScorer.js";
import { boundedScore } from "./scoreModel.js";

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

export type NewIndexedEvent = Omit<
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
  // Award points unconditionally for new events
  await awardPointsAI(eventData);
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
    await awardPointsAI(eventData);
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

export async function awardPointsAI(eventData: NewIndexedEvent): Promise<void> {
  // Nothing to score without an asset/amount — wallet may not even be registered.
  if (!eventData.asset) return;

  const meta = await resolveTokenMeta(eventData.chain, eventData.asset);
  const result = await scoreWithAI({
    eventName: eventData.eventName,
    protocol: eventData.protocol,
    symbol: meta.symbol,
    humanAmount: humanAmount(eventData.amount, meta.decimals),
  });

  const existingWallet = await db.orm.public.RegisteredWallet.where((w: any) =>
    w.wallet.ilike(eventData.wallet)
  ).first();

  const priorRaw = (existingWallet as any)?.rawScore ?? 0;
  const newRaw = priorRaw + result.rawDelta;
  const newDisplay = boundedScore(newRaw);

  if (existingWallet) {
    await db.orm.public.RegisteredWallet.where((w: any) =>
      w.wallet.ilike(eventData.wallet)
    ).update({ rawScore: newRaw, points: Math.round(newDisplay) });
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
