require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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
  loadUnprovenEvents,
  saveEvent,
  markProven,
  getSeenKeys,
  disconnect,
};
