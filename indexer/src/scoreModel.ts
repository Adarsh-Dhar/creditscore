/**
 * Re-exports the shared score model from the `creditscore-db` package.
 * The canonical implementation lives in db/src/scoreModel.ts so the API
 * and the indexer are guaranteed to use the same formula and constants.
 */
export {
  LOWER,
  UPPER,
  MID,
  HALF_RANGE,
  K,
  boundedScore,
} from "creditscore-db/scoreModel";
