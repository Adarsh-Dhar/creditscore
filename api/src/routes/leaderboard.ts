import express, { type Request, type Response, type NextFunction } from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/leaderboard - top wallets by points
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const maxWallets = parseInt(process.env.LEADERBOARD_MAX_WALLETS || "100");
    const limit = parseInt((req.query.limit as string) || "50");
    const effectiveLimit = Math.min(limit, maxWallets);

    // Get registered wallets ordered by points
    const wallets = await (db.orm.public.RegisteredWallet
      .orderBy((w: any) => w.points.desc()) as any)
      .limit(effectiveLimit)
      .all();

    // Add ranks
    const ranked = wallets.map((w: any, i: number) => ({
      rank: i + 1,
      wallet: w.wallet,
      score: w.points,
    }));

    const totalWalletsResult = await db.orm.public.RegisteredWallet.aggregate((a: any) => ({ count: a.count() }));
    const totalWallets = (totalWalletsResult as any).count || 0;

    res.json({
      leaderboard: ranked,
      totalWallets,
      limit: effectiveLimit,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
