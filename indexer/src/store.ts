import path from "node:path";
import dotenv from "dotenv";
import { Temporal } from "@js-temporal/polyfill";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "indexer/.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../db/.env") });

import { db } from "creditscore-db";
import { POINTS_BY_EVENT } from "./config.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured in .env");
}

export interface Checkpoint {
  lastIndexedBlock: number | null;
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

export async function loadEvents(): Promise<{
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
}[]> {
  const events = await db.orm.public.IndexedEvent.orderBy([(e: any) => e.blockNumber.asc(), (e: any) => e.logIndex.asc()]).all();
  return events;
}

export async function saveEvent(eventData: NewIndexedEvent): Promise<{
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
}> {
  const event = await db.orm.public.IndexedEvent.create(eventData);
  // Award points unconditionally for new events
  await awardPoints(eventData.wallet, eventData.eventName);
  return event;
}

export async function upsertEvent(eventData: NewIndexedEvent): Promise<{
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
}> {
  const { txHash, logIndex, ...rest } = eventData;
  
  // Check if event already exists before upsert
  const existing = await db.orm.public.IndexedEvent.where({ txHash, logIndex }).first();

  const event = await db.orm.public.IndexedEvent.upsert({
    conflictOn: { txHash, logIndex },
    create: eventData,
    update: rest,
  });

  // Only award points for new events (when existing was null)
  if (!existing) {
    await awardPoints(eventData.wallet, eventData.eventName);
  }

  return event;
}

export async function loadUnprovenEvents(
  limit = 10,
  chain: string | null = null,
  protocol: string | null = null
): Promise<{
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
}[]> {
  const query = db.orm.public.IndexedEvent.where((e: any) => e.proven.eq(false));
  if (chain) {
    query.where((e: any) => e.chain.eq(chain));
  }
  if (protocol) {
    query.where((e: any) => e.protocol.eq(protocol));
  }

  return (query.orderBy([(e: any) => e.blockNumber.asc(), (e: any) => e.logIndex.asc()]) as any).limit(limit).all();
}

export async function loadEventByTxHash(txHash: string | null | undefined): Promise<{
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
} | null> {
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
