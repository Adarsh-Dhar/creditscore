const express = require('express');
const prisma = require('../db');
const { getScore } = require('../chain');

const router = express.Router();

// GET /api/leaderboard - top wallets by score
// NOTE: This is a live-computed stopgap for MVP. In production, this should
// be cached/snapshotted rather than recomputed on every request, since it
// requires N RPC calls (one per distinct wallet in the DB).
router.get('/', async (req, res, next) => {
  try {
    const maxWallets = parseInt(process.env.LEADERBOARD_MAX_WALLETS || '100');
    const limit = parseInt(req.query.limit || '50');
    const effectiveLimit = Math.min(limit, maxWallets);

    // Get distinct wallets from IndexedEvent
    const wallets = await prisma.indexedEvent.findMany({
      select: { wallet: true },
      distinct: ['wallet'],
      take: maxWallets
    });

    // Fetch scores with concurrency cap to avoid overwhelming RPC
    const CONCURRENCY = 5;
    const results = [];
    
    for (let i = 0; i < wallets.length; i += CONCURRENCY) {
      const batch = wallets.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ({ wallet }) => {
          try {
            const score = await getScore(wallet);
            return { wallet, score: parseInt(score) };
          } catch (error) {
            console.error(`Failed to fetch score for ${wallet}:`, error.message);
            return { wallet, score: 0 };
          }
        })
      );
      results.push(...batchResults);
    }

    // Sort by score descending and limit
    const sorted = results
      .sort((a, b) => b.score - a.score)
      .slice(0, effectiveLimit);

    // Add ranks
    const ranked = sorted.map((item, index) => ({
      rank: index + 1,
      wallet: item.wallet,
      score: item.score
    }));

    res.json({
      leaderboard: ranked,
      totalWallets: wallets.length,
      limit: effectiveLimit
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
