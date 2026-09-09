/**
 * Shared score model — used by both the indexer (to write scores) and the
 * API (to derive the neutral default for unregistered wallets).
 *
 * Converts an unbounded running rawScore accumulator into a bounded
 * 300–850 display score using a tanh squash:
 *
 *   displayScore = MID + HALF_RANGE * tanh(rawScore / K)
 *
 * K is intentionally read from the environment so it can be tuned on Render
 * without a redeploy. Both services must share the same K value.
 */

export const LOWER = 300;
export const UPPER = 850;
export const MID = (UPPER + LOWER) / 2;          // 575
export const HALF_RANGE = (UPPER - LOWER) / 2;   // 275
export const K = Number(process.env.SCORE_SENSITIVITY_K ?? 300);

export function boundedScore(rawScore: number): number {
  return MID + HALF_RANGE * Math.tanh(rawScore / K);
}
