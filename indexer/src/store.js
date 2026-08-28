const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured in .env');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function loadCheckpoint(chain, contractAddress) {
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

async function saveCheckpoint(chain, contractAddress, lastIndexedBlock) {
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

async function loadEvents() {
  const events = await prisma.indexedEvent.findMany({
    orderBy: [
      { blockNumber: 'asc' },
      { logIndex: 'asc' },
    ],
  });
  return events;
}

async function saveEvent(eventData) {
  return await prisma.indexedEvent.create({
    data: eventData,
  });
}

async function upsertEvent(eventData) {
  const { txHash, logIndex, ...rest } = eventData;
  return prisma.indexedEvent.upsert({
    where: {
      txHash_logIndex: { txHash, logIndex },
    },
    create: eventData,
    update: rest,
  });
}

async function loadUnprovenEvents(limit = 10, chain = null, protocol = null) {
  const where = { proven: false };
  if (chain) {
    where.chain = chain;
  }
  if (protocol) {
    where.protocol = protocol;
  }

  return await prisma.indexedEvent.findMany({
    where,
    orderBy: [
      { blockNumber: 'asc' },
      { logIndex: 'asc' },
    ],
    take: limit,
  });
}

async function loadEventByTxHash(txHash) {
  if (!txHash) return null;
  return prisma.indexedEvent.findFirst({
    where: { txHash: { equals: txHash, mode: 'insensitive' } },
  });
}

async function markProven(txHash) {
  await prisma.indexedEvent.updateMany({
    where: { txHash },
    data: { proven: true },
  });
}

async function getSeenKeys() {
  const events = await prisma.indexedEvent.findMany({
    select: {
      txHash: true,
      logIndex: true,
    },
  });
  return new Set(events.map((e) => `${e.txHash}:${e.logIndex}`));
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = {
  loadCheckpoint,
  saveCheckpoint,
  loadEvents,
  loadEventByTxHash,
  loadUnprovenEvents,
  saveEvent,
  upsertEvent,
  markProven,
  getSeenKeys,
  disconnect,
};
