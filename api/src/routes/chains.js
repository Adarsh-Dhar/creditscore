const express = require('express');
const prisma = require('../db');
const { getBlockNumber } = require('../chain');

const router = express.Router();

// GET /api/chains/status - indexer lag for each chain
router.get('/status', async (req, res, next) => {
  try {
    const checkpoints = await prisma.indexerCheckpoint.findMany();

    const statuses = await Promise.all(
      checkpoints.map(async (checkpoint) => {
        try {
          const currentBlock = await getBlockNumber(checkpoint.chain);
          const lag = currentBlock - checkpoint.lastIndexedBlock;
          
          return {
            chain: checkpoint.chain,
            contractAddress: checkpoint.contractAddress,
            lastIndexedBlock: checkpoint.lastIndexedBlock,
            currentBlock,
            lag,
            lagBehind: lag > 0 ? lag : 0,
            updatedAt: checkpoint.updatedAt
          };
        } catch (error) {
          console.error(`Failed to get block number:`, error.message);
          return {
            chain: checkpoint.chain,
            contractAddress: checkpoint.contractAddress,
            lastIndexedBlock: checkpoint.lastIndexedBlock,
            currentBlock: null,
            lag: null,
            lagBehind: null,
            updatedAt: checkpoint.updatedAt,
            error: 'Failed to fetch current block number'
          };
        }
      })
    );

    res.json({
      chains: statuses,
      total: statuses.length
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
