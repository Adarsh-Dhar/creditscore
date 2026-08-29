import express, { type Request, type Response, type NextFunction } from "express";
import { getWeights } from "../chain";

const router = express.Router();

// GET /api/weights - scoring weights from contract
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weights = await getWeights();
    res.json(weights);
  } catch (error) {
    next(error);
  }
});

export default router;
