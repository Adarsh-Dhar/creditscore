"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCheckpoint = loadCheckpoint;
exports.saveCheckpoint = saveCheckpoint;
exports.loadEvents = loadEvents;
exports.saveEvent = saveEvent;
exports.upsertEvent = upsertEvent;
exports.loadUnprovenEvents = loadUnprovenEvents;
exports.loadEventByTxHash = loadEventByTxHash;
exports.markProven = markProven;
exports.getSeenKeys = getSeenKeys;
exports.disconnect = disconnect;
exports.awardPoints = awardPoints;
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: node_path_1.default.resolve(__dirname, "../../.env") });
dotenv_1.default.config({ path: node_path_1.default.resolve(__dirname, "../.env") });
const adapter_pg_1 = require("@prisma/adapter-pg");
const client_1 = require("@prisma/client");
const config_1 = require("./config");
if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured in .env");
}
const adapter = new adapter_pg_1.PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new client_1.PrismaClient({ adapter });
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
        orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    return events;
}
async function saveEvent(eventData) {
    const event = await prisma.indexedEvent.create({
        data: eventData,
    });
    // Award points unconditionally for new events
    await awardPoints(eventData.wallet, eventData.eventName);
    return event;
}
async function upsertEvent(eventData) {
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
async function loadUnprovenEvents(limit = 10, chain = null, protocol = null) {
    const where = { proven: false };
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
async function loadEventByTxHash(txHash) {
    if (!txHash)
        return null;
    return prisma.indexedEvent.findFirst({
        where: { txHash: { equals: txHash, mode: "insensitive" } },
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
async function awardPoints(wallet, eventName) {
    const points = config_1.POINTS_BY_EVENT[eventName];
    if (points === undefined || points === 0)
        return;
    await prisma.registeredWallet.updateMany({
        where: { wallet: { equals: wallet, mode: "insensitive" } },
        data: { points: { increment: points } },
    });
}
//# sourceMappingURL=store.js.map