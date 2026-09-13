import express, { type Request, type Response, type NextFunction } from "express";
import { ethers } from "ethers";
import { Temporal } from "@js-temporal/polyfill";
import db from "../db.js";
import { boundedScore, computeFicoScore, computeUtilizationDrift } from "creditscore-db/scoreModel";

// Map DB eventName -> the stats bucket it belongs to
const EVENT_TO_STAT_KEY: Record<string, string> = {
  Supply: "supplyCount",
  Borrow: "borrowCount",
  Repay: "repayCount",
  Withdraw: "withdrawCount",
  LiquidationCall: "liquidationCount",
};

// NOTE: score now comes from RegisteredWallet.points, which the indexer's
// awardPointsAI() writes after every new event via boundedScore(rawScore).
// There is no longer a call to CreditScoreMVP.sol's score() in this route.
// The on-chain contract is unused by the API going forward.

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

async function getScoreFromDb(
  wallet: string
): Promise<{ score: number; rawScore: number; netOutstandingUSD: number }> {
  const row = await db.orm.public.RegisteredWallet.where((w: any) =>
    w.wallet.ilike(wallet)
  ).first();
  if (!row) {
    // Unregistered wallet — return the neutral midpoint (575), not 0.
    return { score: Math.round(boundedScore(0)), rawScore: 0, netOutstandingUSD: 0 };
  }

  // The Utilization (U) factor decays/recovers continuously, so a wallet
  // sitting on unpaid debt should show a lower score today than yesterday
  // even with zero new transactions. Settle it live at read time — same
  // checkpoint math the indexer uses on write, just not persisted here.
  const rawScore = (row as any).rawScore ?? 0;
  const netOutstandingUSD = (row as any).netOutstandingUSD ?? 0;
  const priorUDrift = (row as any).uDrift ?? 0;
  const lastCheckpointAt = (row as any).lastCheckpointAt || Math.floor(Date.now() / 1000);
  const now = Math.floor(Date.now() / 1000);

  const liveUDrift = computeUtilizationDrift(priorUDrift, netOutstandingUSD, lastCheckpointAt, now);
  const liveScore = computeFicoScore(rawScore, liveUDrift);

  return { score: Math.round(liveScore), rawScore, netOutstandingUSD };
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

    // Get DB score + DB stats in parallel. Score comes from RegisteredWallet.points
    // (written by the indexer's awardPointsAI via boundedScore) — single source of
    // truth, no contract call needed.
    const [stats, scoreData, unprovenCountResult] = await Promise.all([
      getStatsFromDb(checksummedAddress),
      getScoreFromDb(checksummedAddress),
      db.orm.public.IndexedEvent.where((e: any) => 
        e.wallet.ilike(checksummedAddress)
      ).where((e: any) => e.proven.eq(false)).aggregate((a: any) => ({ count: a.count() })).catch(() => ({ count: 0 })),
    ]);

    const unprovenCount = (unprovenCountResult as any).count || 0;

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
      score: scoreData.score.toString(),
      rawScore: scoreData.rawScore,
      netOutstandingUSD: scoreData.netOutstandingUSD,
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

    // Upsert the wallet in RegisteredWallet with neutral midpoint (575)
    const wallet = await db.orm.public.RegisteredWallet.upsert({
      conflictOn: { wallet: checksummedAddress },
      create: {
        wallet: checksummedAddress,
        points: Math.round(boundedScore(0)), // 575
        rawScore: 0,
        netOutstandingUSD: 0,
        uDrift: 0,
        lastCheckpointAt: Math.floor(Date.now() / 1000),
        lastSeenAt: Temporal.Now.instant(),
      },
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

// GET /api/wallets/:address/score-history - score at regular intervals,
// oldest first, for charting. Returns both event-driven changes and
// interpolated drift points so the graph reflects continuous utilization decay.
router.get("/:address/score-history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { address } = req.params;

    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const checksummedAddress = ethers.getAddress(address);

    const [rows, walletRow] = await Promise.all([
      (db.orm.public.AiScoreLog.where((l: any) =>
        l.wallet.ilike(checksummedAddress)
      ).orderBy((l: any) => l.createdAt.asc()) as any).all(),
      db.orm.public.RegisteredWallet.where((w: any) =>
        w.wallet.ilike(checksummedAddress)
      ).first(),
    ]);

    if (rows.length === 0) {
      return res.json({ wallet: checksummedAddress, points: [] });
    }

    // Build a timeline of (timestamp, rawScore, uDrift, netOutstandingUSD)
    // snapshots, one per logged event. Between events and up to now, we
    // interpolate at regular intervals so the graph shows the continuous
    // utilization drift rather than a stale flat line.

    // Snapshot after each logged event
    type Snapshot = {
      ts: number;           // unix seconds
      rawScore: number;
      uDrift: number;
      netOutstandingUSD: number;
      eventName: string;
      rawDelta: number;
      reasoning: string;
    };

    const snapshots: Snapshot[] = rows.map((r: any) => ({
      ts: Math.floor(new Date(r.createdAt).getTime() / 1000),
      rawScore: r.newRawScore,
      uDrift: r.uDrift ?? 0,         // stored uDrift at event time if present
      netOutstandingUSD: r.netOutstandingUSD ?? 0,
      eventName: r.eventName,
      rawDelta: r.rawDelta,
      reasoning: r.reasoning,
    }));

    // For snapshots that don't have uDrift/netOutstandingUSD stored (older
    // rows before those columns were added to AiScoreLog), we can only show
    // the recorded newDisplayScore — fall back to reading it directly.
    const hasUDriftInLog = rows[0]?.uDrift !== undefined && rows[0]?.uDrift !== null;

    if (!hasUDriftInLog) {
      // Old schema — just return the rounded log values + a live "Now" point
      const points = rows.map((r: any) => ({
        timestamp: r.createdAt,
        score: Math.round(r.newDisplayScore),
        eventName: r.eventName,
        delta: r.rawDelta,
        reasoning: r.reasoning,
      }));

      const liveScore = walletRow
        ? (() => {
            const rawScore = (walletRow as any).rawScore ?? 0;
            const uDrift = (walletRow as any).uDrift ?? 0;
            const lastCheckpointAt = (walletRow as any).lastCheckpointAt || Math.floor(Date.now() / 1000);
            const netOutstandingUSD = (walletRow as any).netOutstandingUSD ?? 0;
            const now = Math.floor(Date.now() / 1000);
            const liveUDrift = computeUtilizationDrift(uDrift, netOutstandingUSD, lastCheckpointAt, now);
            return Math.round(computeFicoScore(rawScore, liveUDrift));
          })()
        : null;

      const lastScore = points[points.length - 1].score;
      if (liveScore !== null && liveScore !== lastScore) {
        points.push({
          timestamp: new Date().toISOString(),
          score: liveScore,
          eventName: "Now",
          delta: liveScore - lastScore,
          reasoning: "Live score (utilization drift applied)",
        });
      }

      return res.json({ wallet: checksummedAddress, points });
    }

    // New schema — interpolate continuous drift between events
    const points: Array<{
      timestamp: string;
      score: number;
      eventName: string;
      delta: number;
      reasoning: string;
    }> = [];

    // Emit a score point at an arbitrary (rawScore, uDrift, netOutstandingUSD)
    // state — settling uDrift from `checkpointTs` up to `toTs` first.
    function emitPoint(
      rawScore: number,
      uDrift: number,
      netOutstandingUSD: number,
      checkpointTs: number,
      toTs: number,
      eventName: string,
      delta: number,
      reasoning: string,
    ) {
      const settledUDrift = computeUtilizationDrift(uDrift, netOutstandingUSD, checkpointTs, toTs);
      const score = Math.round(computeFicoScore(rawScore, settledUDrift));
      points.push({
        timestamp: new Date(toTs * 1000).toISOString(),
        score,
        eventName,
        delta,
        reasoning,
      });
    }

    // Emit each event point
    for (const snap of snapshots) {
      emitPoint(
        snap.rawScore,
        snap.uDrift,
        snap.netOutstandingUSD,
        snap.ts,  // already settled to this ts at write time
        snap.ts,
        snap.eventName,
        snap.rawDelta,
        snap.reasoning,
      );
    }

    // Now interpolate from last event up to now using live wallet state
    if (walletRow) {
      const lastSnap = snapshots[snapshots.length - 1];
      const rawScore = (walletRow as any).rawScore ?? lastSnap.rawScore;
      const uDrift = (walletRow as any).uDrift ?? lastSnap.uDrift;
      const netOutstandingUSD = (walletRow as any).netOutstandingUSD ?? lastSnap.netOutstandingUSD;
      const lastCheckpointAt = (walletRow as any).lastCheckpointAt || lastSnap.ts;
      const nowTs = Math.floor(Date.now() / 1000);
      const spanSeconds = nowTs - lastCheckpointAt;

      // Only interpolate if there's meaningful time elapsed (> 1 hour)
      // and the wallet has outstanding debt (so drift is actually moving).
      const INTERPOLATE_MIN_SPAN = 3600; // 1 hour
      if (spanSeconds > INTERPOLATE_MIN_SPAN && netOutstandingUSD > 0) {
        // Emit ~6 intermediate points spread across the gap (max 1 per hour)
        const numSteps = Math.min(6, Math.floor(spanSeconds / INTERPOLATE_MIN_SPAN));
        const stepSize = Math.floor(spanSeconds / (numSteps + 1));
        for (let i = 1; i <= numSteps; i++) {
          const stepTs = lastCheckpointAt + stepSize * i;
          emitPoint(rawScore, uDrift, netOutstandingUSD, lastCheckpointAt, stepTs, "Drift", 0, "Utilization drift (no new events)");
        }
      }

      // Always emit the live "Now" point
      const liveUDrift = computeUtilizationDrift(uDrift, netOutstandingUSD, lastCheckpointAt, nowTs);
      const liveScore = Math.round(computeFicoScore(rawScore, liveUDrift));
      const lastEmittedScore = points[points.length - 1].score;
      if (liveScore !== lastEmittedScore) {
        points.push({
          timestamp: new Date().toISOString(),
          score: liveScore,
          eventName: "Now",
          delta: liveScore - lastEmittedScore,
          reasoning: "Live score (utilization drift applied)",
        });
      }
    }

    res.json({ wallet: checksummedAddress, points });
  } catch (error) {
    next(error);
  }
});

export default router;