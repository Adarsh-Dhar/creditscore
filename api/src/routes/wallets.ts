import express, { type Request, type Response, type NextFunction } from "express";
import { ethers } from "ethers";
import prisma from "../db";
import { getScore, getStats } from "../chain";
import type { Prisma } from "@prisma/client";

const router = express.Router();

// GET /api/wallets/:address/events - paginated events for a wallet
router.get("/:address/events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;
    const { eventName, proven, protocol, page = "1", limit = "50" } = req.query as Record<string, string>;

    // Validate and checksum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const checksummedAddress = ethers.getAddress(address);

    const where: Prisma.IndexedEventWhereInput = {
      wallet: { equals: checksummedAddress, mode: "insensitive" },
    };
    if (eventName) {
      where.eventName = eventName;
    }
    if (proven !== undefined) {
      where.proven = proven === "true";
    }
    if (protocol) {
      where.protocol = protocol;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [events, total] = await Promise.all([
      prisma.indexedEvent.findMany({
        where,
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        skip,
        take,
      }),
      prisma.indexedEvent.count({ where }),
    ]);

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/wallets/:address/summary - score, stats, and summary from DB
router.get("/:address/summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;

    // Validate and checksum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const checksummedAddress = ethers.getAddress(address);

    // Get on-chain data in parallel
    const [score, stats, unprovenCount] = await Promise.all([
      getScore(checksummedAddress).catch(() => "0"),
      getStats(checksummedAddress).catch(() => ({
        supplyCount: "0",
        borrowCount: "0",
        repayCount: "0",
        withdrawCount: "0",
        liquidationCount: "0",
      })),
      prisma.indexedEvent
        .count({
          where: {
            wallet: { equals: checksummedAddress, mode: "insensitive" },
            proven: false,
          },
        })
        .catch(() => 0),
    ]);

    // Get last event timestamp
    const lastEvent = await prisma.indexedEvent.findFirst({
      where: { wallet: { equals: checksummedAddress, mode: "insensitive" } },
      orderBy: { blockNumber: "desc" },
    });

    // Get protocol breakdown from DB (off-chain only)
    const protocolBreakdown = await prisma.indexedEvent.groupBy({
      by: ["protocol", "eventName"],
      where: { wallet: { equals: checksummedAddress, mode: "insensitive" } },
      _count: { id: true },
    });

    // Format protocol breakdown for easier consumption
    const protocolSummary: Record<string, Record<string, number>> = {};
    for (const item of protocolBreakdown) {
      if (!protocolSummary[item.protocol]) {
        protocolSummary[item.protocol] = {};
      }
      protocolSummary[item.protocol][item.eventName] = item._count.id;
    }

    res.json({
      address: checksummedAddress,
      score,
      stats,
      unprovenCount,
      lastEventAt: lastEvent?.timestamp ? new Date(lastEvent.timestamp * 1000).toISOString() : null,
      protocolBreakdown: protocolSummary,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
