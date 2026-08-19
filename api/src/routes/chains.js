const express = require('express');
const prisma = require('../db');
const { getBlockNumber } = require('../chain');

const router = express.Router();

// GET /api/chains/status - indexer lag for each chain
router.get('/status', async (req, res, next) => {
  try {
    const checkpoints = await prisma.indexerCheckpoint.findMany();

    // Group by chain to avoid duplicates
    const chainMap = new Map();

    for (const checkpoint of checkpoints) {
      if (!chainMap.has(checkpoint.chain)) {
        try {
          const currentBlock = await getBlockNumber(checkpoint.chain);
          const lag = currentBlock - checkpoint.lastIndexedBlock;
          
          chainMap.set(checkpoint.chain, {
            chain: checkpoint.chain,
            lastIndexedBlock: checkpoint.lastIndexedBlock,
            currentBlock,
            lag,
            lagBehind: lag > 0 ? lag : 0,
            updatedAt: checkpoint.updatedAt
          });
        } catch (error) {
          console.error(`Failed to get block number:`, error.message);
          chainMap.set(checkpoint.chain, {
            chain: checkpoint.chain,
            lastIndexedBlock: checkpoint.lastIndexedBlock,
            currentBlock: null,
            lag: null,
            lagBehind: null,
            updatedAt: checkpoint.updatedAt,
            error: 'Failed to fetch current block number'
          });
        }
      }
    }

    const statuses = Array.from(chainMap.values());

    res.json({
      chains: statuses,
      total: statuses.length
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
