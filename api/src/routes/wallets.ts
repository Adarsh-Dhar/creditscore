import express, { type Request, type Response, type NextFunction } from "express";
import { ethers } from "ethers";
import { Temporal } from "@js-temporal/polyfill";
import db from "../db.js";

// Map DB eventName -> the stats bucket it belongs to
const EVENT_TO_STAT_KEY: Record<string, string> = {
  Supply: "supplyCount",
  Borrow: "borrowCount",
  Repay: "repayCount",
  Withdraw: "withdrawCount",
  LiquidationCall: "liquidationCount",
};

const EVENT_WEIGHTS: Record<string, number> = {
  Supply: 5,
  Borrow: 2,
  Repay: 15,
  Withdraw: 0,
  LiquidationCall: -20,
};

async function getStatsFromDb(wallet: string) {
  const events = await db.orm.public.IndexedEvent.where((e: any) => 
    e.wallet.ilike(wallet)
  ).where((e: any) => e.proven.eq(true)).all();

  const stats = {
    supplyCount: "0",
    borrowCount: "0",
    repayCount: "0",
    withdrawCount: "0",
    liquidationCount: "0",
  };

  for (const event of events) {
    const key = EVENT_TO_STAT_KEY[event.eventName];
    if (key) {
      stats[key as keyof typeof stats] = (parseInt(stats[key as keyof typeof stats]) + 1).toString();
    }
  }

  return stats;
}

const router: express.Router = express.Router();

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

    const query = db.orm.public.IndexedEvent.where((e: any) => 
      e.wallet.ilike(checksummedAddress)
    );
    
    if (eventName) {
      query.where((e: any) => e.eventName.eq(eventName));
    }
    if (proven !== undefined) {
      query.where((e: any) => e.proven.eq(proven === "true"));
    }
    if (protocol) {
      query.where((e: any) => e.protocol.eq(protocol));
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [events, totalResult] = await Promise.all([
      (query.orderBy([(e: any) => e.blockNumber.desc(), (e: any) => e.logIndex.desc()]) as any).offset(skip).limit(take).all(),
      query.aggregate((a: any) => ({ count: a.count() })),
    ]);

    const total = (totalResult as any).count || 0;

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
    const [stats, unprovenCountResult] = await Promise.all([
      getStatsFromDb(checksummedAddress),
      db.orm.public.IndexedEvent.where((e: any) => 
        e.wallet.ilike(checksummedAddress)
      ).where((e: any) => e.proven.eq(false)).aggregate((a: any) => ({ count: a.count() })).catch(() => ({ count: 0 })),
    ]);

    const unprovenCount = (unprovenCountResult as any).count || 0;

    const score = (
      parseInt(stats.supplyCount) * EVENT_WEIGHTS.Supply +
      parseInt(stats.borrowCount) * EVENT_WEIGHTS.Borrow +
      parseInt(stats.repayCount) * EVENT_WEIGHTS.Repay +
      parseInt(stats.withdrawCount) * EVENT_WEIGHTS.Withdraw +
      parseInt(stats.liquidationCount) * EVENT_WEIGHTS.LiquidationCall
    ).toString();

    // Get last event timestamp
    const lastEvent = await db.orm.public.IndexedEvent.where((e: any) => 
      e.wallet.ilike(checksummedAddress)
    ).orderBy((e: any) => e.blockNumber.desc()).first();

    // Get protocol breakdown from DB (off-chain only)
    const events = await db.orm.public.IndexedEvent.where((e: any) => 
      e.wallet.ilike(checksummedAddress)
    ).all();

    // Format protocol breakdown for easier consumption
    const protocolSummary: Record<string, Record<string, number>> = {};
    for (const event of events) {
      if (!protocolSummary[event.protocol]) {
        protocolSummary[event.protocol] = {};
      }
      if (!protocolSummary[event.protocol][event.eventName]) {
        protocolSummary[event.protocol][event.eventName] = 0;
      }
      protocolSummary[event.protocol][event.eventName]++;
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

// POST /api/wallets/:address/register - register a wallet for points tracking
router.post("/:address/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;

    // Validate and checksum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const checksummedAddress = ethers.getAddress(address);

    // Upsert the wallet in RegisteredWallet
    const wallet = await db.orm.public.RegisteredWallet.upsert({
      create: { wallet: checksummedAddress, points: 0 },
      update: { lastSeenAt: Temporal.Now.instant() },
    });

    res.json({
      wallet: wallet.wallet,
      points: wallet.points,
      registered: true,
    });
  } catch (error) {
    next(error);
  }
});

export default router;