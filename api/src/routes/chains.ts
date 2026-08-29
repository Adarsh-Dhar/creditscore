import express, { type Request, type Response, type NextFunction } from "express";
import prisma from "../db";
import { getBlockNumber } from "../chain";

const router = express.Router();

interface ChainStatus {
  chain: string;
  lastIndexedBlock: number;
  currentBlock: number | null;
  lag: number | null;
  lagBehind: number | null;
  updatedAt: Date;
  error?: string;
}

// GET /api/chains/status - indexer lag for each chain
router.get("/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const checkpoints = await prisma.indexerCheckpoint.findMany();

    // Group by chain to avoid duplicates
    const chainMap = new Map<string, ChainStatus>();

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
            updatedAt: checkpoint.updatedAt,
          });
        } catch (error: any) {
          console.error(`Failed to get block number:`, error.message);
          chainMap.set(checkpoint.chain, {
            chain: checkpoint.chain,
            lastIndexedBlock: checkpoint.lastIndexedBlock,
            currentBlock: null,
            lag: null,
            lagBehind: null,
            updatedAt: checkpoint.updatedAt,
            error: "Failed to fetch current block number",
          });
        }
      }
    }

    const statuses = Array.from(chainMap.values());

    res.json({
      chains: statuses,
      total: statuses.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
