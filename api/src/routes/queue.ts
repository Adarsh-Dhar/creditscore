import express, { type Request, type Response, type NextFunction } from "express";
import prisma from "../db";
import type { Prisma } from "@prisma/client";

const router = express.Router();

// GET /api/queue/unproven - oldest-first unproven events
// NOTE: This endpoint has no authentication. Before any public deploy,
// this should be gated (e.g., API key, IP whitelist, or auth middleware)
// to prevent unauthorized access to the proving queue.
router.get("/unproven", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = "10", chain } = req.query as Record<string, string>;

    const where: Prisma.IndexedEventWhereInput = { proven: false };
    if (chain) {
      where.chain = chain;
    }

    const events = await prisma.indexedEvent.findMany({
      where,
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      take: parseInt(limit),
    });

    const total = await prisma.indexedEvent.count({ where });

    res.json({
      events,
      total,
      limit: parseInt(limit),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
