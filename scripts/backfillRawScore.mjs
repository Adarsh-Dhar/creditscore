#!/usr/bin/env node
/**
 * One-time backfill: convert every wallet's current flat `points` value into
 * the equivalent `rawScore` that would reproduce roughly the same displayed
 * score under the tanh model.
 *
 * Inverse of  displayScore = MID + HALF_RANGE * tanh(rawScore / K)  is:
 *   rawScore = K * atanh( (displayScore - MID) / HALF_RANGE )
 *
 * We treat the existing `points` column as the display score, clamp it
 * strictly inside the open interval (300, 850) to keep atanh finite, then
 * solve for rawScore.
 *
 * Run once, after the schema migration, before deploying the new scoring code:
 *   node scripts/backfillRawScore.mjs
 */

import pg from 'pg';

const K = 300;
const MID = 575;      // (850 + 300) / 2
const HALF = 275;     // (850 - 300) / 2

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query('SELECT id, points FROM "public"."registeredWallet"');

if (rows.length === 0) {
  console.log('No wallets found — nothing to backfill.');
  await client.end();
  process.exit(0);
}

console.log(`Backfilling ${rows.length} wallet(s)...\n`);

for (const { id, points } of rows) {
  // Clamp strictly inside the open interval (300, 850) so atanh stays finite.
  const clamped = Math.max(301, Math.min(849, points));
  const x = (clamped - MID) / HALF;  // in (-1, 1)
  const rawScore = K * Math.atanh(x);
  const displayScore = Math.round(MID + HALF * Math.tanh(rawScore / K)); // always == clamped, but explicit
  await client.query(
    'UPDATE "public"."registeredWallet" SET "rawScore" = $1, "points" = $2 WHERE id = $3',
    [rawScore, displayScore, id],
  );
  console.log(`  id=${id}  points=${points} -> displayScore=${displayScore}  rawScore=${rawScore.toFixed(2)}`);
}

console.log('\nBackfill complete.');
await client.end();
