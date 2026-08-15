const express = require('express');
const prisma = require('../db');

const router = express.Router();

// GET /api/queue/unproven - oldest-first unproven events
// NOTE: This endpoint has no authentication. Before any public deploy,
// this should be gated (e.g., API key, IP whitelist, or auth middleware)
// to prevent unauthorized access to the proving queue.
router.get('/unproven', async (req, res, next) => {
  try {
    const { limit = 10, chain } = req.query;

    const where = { proven: false };
    if (chain) {
      where.chain = chain;
    }

    const events = await prisma.indexedEvent.findMany({
      where,
      orderBy: [
        { blockNumber: 'asc' },
        { logIndex: 'asc' }
      ],
      take: parseInt(limit)
    });

    const total = await prisma.indexedEvent.count({ where });

    res.json({
      events,
      total,
      limit: parseInt(limit)
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
