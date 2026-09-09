/**
 * Shared score model — used by both the indexer (to write scores) and the
 * API (to derive the neutral default for unregistered wallets).
 *
 * ---------------------------------------------------------------------
 * FICO-style composite
 * ---------------------------------------------------------------------
 * Score = 300 + 550 * [0.35*P + 0.30*U + 0.15*L + 0.10*N + 0.10*M]
 *
 *   P (Payment History, 35%) — AI-judged severity of individual events
 *     (Repay/LiquidationCall/etc.), accumulated into `rawScore` exactly as
 *     before, then normalized into [0,1] via tanh.
 *   U (Utilization, 30%) — NEW: a continuous, deterministic factor driven
 *     by the wallet's outstanding debt over time, not a per-event bump.
 *     More borrowed + more time unpaid => U falls (faster for bigger
 *     debt). Net repaid >= net borrowed => U climbs back up. See
 *     computeUtilizationDrift() below.
 *   L, N, M (Length of history / New credit / Credit mix, 35% combined)
 *     — not implemented yet. Held at the neutral midpoint (0.5) so the
 *     formula is complete and can be upgraded factor-by-factor later
 *     without changing the composite's shape.
 *
 * boundedScore() (the original tanh squash on rawScore alone) is kept for
 * backward compatibility (e.g. the unregistered-wallet default, and the
 * existing backfill script's math) but the live scoring path now uses
 * computeFicoScore(), which folds in the continuous U factor.
 */

export const LOWER = 300;
export const UPPER = 850;
export const MID = (UPPER + LOWER) / 2;          // 575
export const HALF_RANGE = (UPPER - LOWER) / 2;   // 275
// K controls rawScore sensitivity. Lower value = more sensitive to small transactions.
// Default 300 is for real loan sizes. Use ~30-50 for demo/testnet with dust amounts.
export const K = Number(process.env.SCORE_SENSITIVITY_K ?? 50);

/** @deprecated Superseded by computeFicoScore(). Kept for the unregistered
 *  wallet default and scripts/backfillRawScore.mjs's inverse-tanh math. */
export function boundedScore(rawScore: number): number {
  return MID + HALF_RANGE * Math.tanh(rawScore / K);
}

// ---------------------------------------------------------------------
// Continuous Utilization (U) factor
// ---------------------------------------------------------------------

/** Points of uDrift lost per (USD of net debt * second) while netOutstandingUSD > 0.
 *  Default calibrated so a $1,000 unpaid debt costs roughly 1 uDrift-point/day:
 *  1000 * ALPHA * 86400 ≈ 1  =>  ALPHA ≈ 1 / (1000 * 86400).
 *  For demo/testnet with smaller amounts, use ~1/10 of this rate. */
export const ALPHA = Number(process.env.SCORE_DECAY_ALPHA ?? 1 / (10000 * 86400));

/** Points of uDrift gained per second while debt-free (netOutstandingUSD <= 0).
 *  Deliberately much slower than a typical decay, so recovery is gradual
 *  and earned rather than instant — mirrors real bureaus' slow rebuild. */
export const BETA = Number(process.env.SCORE_RECOVERY_BETA ?? 0.002 / 86400);

/** Sensitivity constant for squashing uDrift into the [0,1] U factor via tanh.
 *  Lower value = more sensitive to small uDrift changes. Default 50 works for demo/testnet. */
export const K_U = Number(process.env.SCORE_UTILIZATION_K ?? 25);

/**
 * Settles the Utilization drift accumulator from `lastCheckpointAt` up to
 * `now`, using the debt balance that was in effect *before* whatever event
 * (if any) triggered this call. This is the checkpoint-accumulator pattern
 * (same trick TWAP oracles use): callers must settle drift with the OLD
 * netOutstandingUSD first, and only afterwards apply the event's effect on
 * the balance itself — otherwise a new balance gets applied retroactively
 * to time that already elapsed.
 */
export function computeUtilizationDrift(
  priorDrift: number,
  netOutstandingUSD: number,
  lastCheckpointAt: number,
  now: number
): number {
  const elapsed = Math.max(0, now - lastCheckpointAt);
  const rate = netOutstandingUSD > 0 ? -ALPHA * netOutstandingUSD : BETA;
  return priorDrift + rate * elapsed;
}

/** Normalizes the Utilization accumulator into FICO's [0,1] factor range. */
export function utilizationFactor(uDrift: number): number {
  return 0.5 + 0.5 * Math.tanh(uDrift / K_U);
}

/** Normalizes the Payment History accumulator (the existing AI rawScore)
 *  into FICO's [0,1] factor range. */
export function paymentHistoryFactor(rawScore: number): number {
  return 0.5 + 0.5 * Math.tanh(rawScore / K);
}

export const WEIGHT_P = 0.55;  // Payment History weight
export const WEIGHT_U = 0.45;  // Utilization weight
// L, N, M factors disabled until implemented - weights redistributed to P and U

/**
 * Composite FICO-style score: 300 + 550 * weighted sum of factors.
 * P (Payment History) and U (Utilization) are the only active factors.
 * L, N, M factors are disabled until implemented - their weights were
 * redistributed to P and U (55% and 45% respectively).
 */
export function computeFicoScore(rawScore: number, uDrift: number): number {
  const P = paymentHistoryFactor(rawScore);
  const U = utilizationFactor(uDrift);
  const composite = WEIGHT_P * P + WEIGHT_U * U;
  return LOWER + (UPPER - LOWER) * composite;
}
