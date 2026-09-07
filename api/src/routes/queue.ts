import express, { type Request, type Response, type NextFunction } from "express";
import db from "../db.js";

const router = express.Router();

// GET /api/queue/unproven - oldest-first unproven events
// NOTE: This endpoint has no authentication. Before any public deploy,
// this should be gated (e.g., API key, IP whitelist, or auth middleware)
// to prevent unauthorized access to the proving queue.
router.get("/unproven", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = "10", chain } = req.query as Record<string, string>;

    const query = db.orm.public.IndexedEvent.where((e: any) => e.proven.eq(false));
    if (chain) {
      query.where((e: any) => e.chain.eq(chain));
    }

    const events = await (query.orderBy([(e: any) => e.blockNumber.asc(), (e: any) => e.logIndex.asc()]) as any).limit(parseInt(limit)).all();
    const totalResult = await query.aggregate((a: any) => ({ count: a.count() }));
    const total = (totalResult as any).count || 0;

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
