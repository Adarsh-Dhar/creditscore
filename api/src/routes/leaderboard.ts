import express, { type Request, type Response, type NextFunction } from "express";
import prisma from "../db";

const router = express.Router();

// GET /api/leaderboard - top wallets by points
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const maxWallets = parseInt(process.env.LEADERBOARD_MAX_WALLETS || "100");
    const limit = parseInt((req.query.limit as string) || "50");
    const effectiveLimit = Math.min(limit, maxWallets);

    // Get registered wallets ordered by points
    const wallets = await prisma.registeredWallet.findMany({
      select: { wallet: true, points: true },
      orderBy: { points: "desc" },
      take: effectiveLimit,
    });

    // Add ranks
    const ranked = wallets.map((w, i) => ({
      rank: i + 1,
      wallet: w.wallet,
      score: w.points,
    }));

    const totalWallets = await prisma.registeredWallet.count();

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
