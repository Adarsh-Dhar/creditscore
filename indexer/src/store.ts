import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type IndexedEvent, type Prisma } from "@prisma/client";
import { POINTS_BY_EVENT } from "./config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured in .env");
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

export interface Checkpoint {
  lastIndexedBlock: number | null;
}

export type NewIndexedEvent = Omit<IndexedEvent, "id" | "createdAt">;

export async function loadCheckpoint(chain: string, contractAddress: string): Promise<Checkpoint> {
  const checkpoint = await prisma.indexerCheckpoint.findUnique({
    where: {
      chain_contractAddress: {
        chain,
        contractAddress,
      },
    },
  });
  return checkpoint || { lastIndexedBlock: null };
}

export async function saveCheckpoint(
  chain: string,
  contractAddress: string,
  lastIndexedBlock: number
): Promise<void> {
  await prisma.indexerCheckpoint.upsert({
    where: {
      chain_contractAddress: {
        chain,
        contractAddress,
      },
    },
    update: {
      lastIndexedBlock,
    },
    create: {
      chain,
      contractAddress,
      lastIndexedBlock,
    },
  });
}

export async function loadEvents(): Promise<IndexedEvent[]> {
  const events = await prisma.indexedEvent.findMany({
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });
  return events;
}

export async function saveEvent(eventData: NewIndexedEvent): Promise<IndexedEvent> {
  const event = await prisma.indexedEvent.create({
    data: eventData,
  });
  // Award points unconditionally for new events
  await awardPoints(eventData.wallet, eventData.eventName);
  return event;
}

export async function upsertEvent(eventData: NewIndexedEvent): Promise<IndexedEvent> {
  const { txHash, logIndex, ...rest } = eventData;
  
  // Check if event already exists before upsert
  const existing = await prisma.indexedEvent.findUnique({
    where: { txHash_logIndex: { txHash, logIndex } },
    select: { id: true },
  });

  const event = await prisma.indexedEvent.upsert({
    where: {
      txHash_logIndex: { txHash, logIndex },
    },
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
): Promise<IndexedEvent[]> {
  const where: Prisma.IndexedEventWhereInput = { proven: false };
  if (chain) {
    where.chain = chain;
  }
  if (protocol) {
    where.protocol = protocol;
  }

  return prisma.indexedEvent.findMany({
    where,
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    take: limit,
  });
}

export async function loadEventByTxHash(txHash: string | null | undefined): Promise<IndexedEvent | null> {
  if (!txHash) return null;
  return prisma.indexedEvent.findFirst({
    where: { txHash: { equals: txHash, mode: "insensitive" } },
  });
}

export async function markProven(txHash: string): Promise<void> {
  await prisma.indexedEvent.updateMany({
    where: { txHash },
    data: { proven: true },
  });
}

export async function getSeenKeys(): Promise<Set<string>> {
  const events = await prisma.indexedEvent.findMany({
    select: {
      txHash: true,
      logIndex: true,
    },
  });
  return new Set(events.map((e) => `${e.txHash}:${e.logIndex}`));
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

export async function awardPoints(wallet: string, eventName: string): Promise<void> {
  const points = POINTS_BY_EVENT[eventName];
  if (points === undefined || points === 0) return;

  await prisma.registeredWallet.upsert({
    where: { wallet },
    update: {
      points: { increment: points },
      lastSeenAt: new Date(),
    },
    create: {
      wallet,
      points,
    },
  });
}
