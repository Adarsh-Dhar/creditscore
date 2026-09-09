#!/usr/bin/env node
/**
 * One-time backfill for the continuous Utilization (U) factor.
 *
 * Run once, after `scripts/migrate.mjs` has added the netOutstandingUSD /
 * uDrift / lastCheckpointAt columns, and before deploying the new scoring
 * code:
 *
 *   node scripts/backfillUtilization.mjs
 *
 * What it does, per existing wallet:
 *   - netOutstandingUSD -> 0 (we don't have historical per-asset USD
 *     pricing for past events, so we start every wallet debt-free under
 *     the new model rather than guess; it will accumulate correctly from
 *     here on as new Borrow/Repay events come in)
 *   - uDrift -> 0 (neutral starting point => utilizationFactor(0) = 0.5,
 *     matching the neutral L/N/M placeholders in scoreModel.ts)
 *   - lastCheckpointAt -> now (so the first live read/event settles a
 *     zero-length elapsed window instead of drifting from the epoch)
 *
 * This does NOT change `points` or `rawScore` — the existing Payment
 * History (P) backfill in backfillRawScore.mjs is unaffected and can be
 * run independently.
 */

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const now = Math.floor(Date.now() / 1000);

const { rows } = await client.query('SELECT id FROM "public"."registeredWallet"');

if (rows.length === 0) {
  console.log('No wallets found — nothing to backfill.');
  await client.end();
  process.exit(0);
}

console.log(`Backfilling utilization state for ${rows.length} wallet(s)...\n`);

await client.query(
  'UPDATE "public"."registeredWallet" SET "netOutstandingUSD" = 0, "uDrift" = 0, "lastCheckpointAt" = $1',
  [now],
);

console.log(`Set netOutstandingUSD=0, uDrift=0, lastCheckpointAt=${now} for all wallets.`);
console.log('\nBackfill complete.');
await client.end();
