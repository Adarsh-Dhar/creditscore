const express = require('express');
const { ethers } = require('ethers');
const prisma = require('../db');
const { getScore, getStats } = require('../chain');

const router = express.Router();

// GET /api/wallets/:address/events - paginated events for a wallet
router.get('/:address/events', async (req, res, next) => {
  try {
    const { address } = req.params;
    const { eventName, proven, page = 1, limit = 50 } = req.query;

    // Validate and checksum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    const checksummedAddress = ethers.getAddress(address);

    const where = { wallet: checksummedAddress };
    if (eventName) {
      where.eventName = eventName;
    }
    if (proven !== undefined) {
      where.proven = proven === 'true';
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [events, total] = await Promise.all([
      prisma.indexedEvent.findMany({
        where,
        orderBy: [
          { blockNumber: 'desc' },
          { logIndex: 'desc' }
        ],
        skip,
        take
      }),
      prisma.indexedEvent.count({ where })
    ]);

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: take,
        total,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/wallets/:address/summary - score, stats, and summary from DB
router.get('/:address/summary', async (req, res, next) => {
  try {
    const { address } = req.params;

    // Validate and checksum address
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    const checksummedAddress = ethers.getAddress(address);

    // Get on-chain data in parallel
    const [score, stats, unprovenCount] = await Promise.all([
      getScore(checksummedAddress).catch(() => '0'),
      getStats(checksummedAddress).catch(() => ({
        supplyCount: '0',
        borrowCount: '0',
        repayCount: '0',
        withdrawCount: '0',
        liquidationCount: '0'
      })),
      prisma.indexedEvent.count({
        where: { 
          wallet: checksummedAddress,
          proven: false 
        }
      }).catch(() => 0)
    ]);

    // Get last event timestamp
    const lastEvent = await prisma.indexedEvent.findFirst({
      where: { wallet: checksummedAddress },
      orderBy: { blockNumber: 'desc' }
    });

    res.json({
      address: checksummedAddress,
      score,
      stats,
      unprovenCount,
      lastEventAt: lastEvent?.timestamp ? new Date(lastEvent.timestamp * 1000).toISOString() : null
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
