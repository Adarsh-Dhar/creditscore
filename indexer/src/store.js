require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

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
  await pool.end();
}

module.exports = {
  loadCheckpoint,
  saveCheckpoint,
  loadEvents,
  saveEvent,
  getSeenKeys,
  disconnect,
};
