#!/usr/bin/env node
import pg from 'pg';
import { computeFicoScore, computeUtilizationDrift, paymentHistoryFactor, utilizationFactor } from '../db/src/scoreModel.ts';
import { POINTS_BY_EVENT } from '../indexer/src/config.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

console.log('--- 1. Cleaning up third-party wallets from registeredWallet & aiScoreLog ---');

// Keep only the user's wallet
const { rowCount: deletedWallets } = await client.query(
  'DELETE FROM "public"."registeredWallet" WHERE "wallet" NOT ILIKE $1',
  ['%b8552e%']
);
console.log(`Deleted ${deletedWallets} third-party wallet(s) from registeredWallet.`);

const { rowCount: deletedAiLogs } = await client.query(
  'DELETE FROM "public"."aiScoreLog" WHERE "wallet" NOT ILIKE $1',
  ['%b8552e%']
);
console.log(`Deleted ${deletedAiLogs} third-party aiScoreLog row(s).`);

console.log('\n--- 2. Rescoring user wallet from its 12 indexed events ---');

const { rows: events } = await client.query(
  'SELECT "id", "eventName", "amount", "asset", "protocol", "timestamp", "blockNumber", "logIndex" FROM "public"."indexedEvent" WHERE "wallet" ILIKE $1 ORDER BY "blockNumber" ASC, "logIndex" ASC',
  ['%b8552e%']
);

console.log(`Found ${events.length} events for user wallet.`);

// Clean baseline
let rawScore = 0;
let netOutstandingUSD = 0;
let uDrift = 0;
let lastCheckpointAt = events[0]?.timestamp || Math.floor(Date.now() / 1000);

for (const event of events) {
  const now = event.timestamp || lastCheckpointAt;
  uDrift = computeUtilizationDrift(uDrift, netOutstandingUSD, lastCheckpointAt, now);
  lastCheckpointAt = now;

  // Resolve USD value for debt tracking
  let priceUSD = 1;
  let decimals = 18;
  const assetLower = (event.asset || '').toLowerCase();
  if (assetLower.includes('94a9d9ac') || assetLower.includes('b8552e') || assetLower.includes('1c7d4b19')) {
    // USDC (6 decimals)
    decimals = 6;
    priceUSD = 1;
  } else if (assetLower.includes('c558dbdd') || assetLower.includes('2d5ee574')) {
    // WETH (18 decimals)
    decimals = 18;
    priceUSD = 3200;
  }

  const humanAmt = Number(event.amount) / (10 ** decimals);
  const amountUSD = humanAmt * priceUSD;

  if (event.eventName === 'Borrow') {
    netOutstandingUSD += amountUSD;
  } else if (event.eventName === 'Repay') {
    netOutstandingUSD = Math.max(0, netOutstandingUSD - amountUSD);
  } else if (event.eventName === 'LiquidationCall') {
    netOutstandingUSD = 0;
  }

  const rawDelta = POINTS_BY_EVENT[event.eventName] ?? 5;
  rawScore += rawDelta;

  const currentDisplay = computeFicoScore(rawScore, uDrift);
  console.log(`  Event ${event.eventName} (${event.amount}): rawDelta=+${rawDelta}, rawScore=${rawScore}, debt=$${netOutstandingUSD.toFixed(2)}, interimScore=${Math.round(currentDisplay)}`);
}

// Settle drift up to current time
const now = Math.floor(Date.now() / 1000);
uDrift = computeUtilizationDrift(uDrift, netOutstandingUSD, lastCheckpointAt, now);
lastCheckpointAt = now;

const finalScore = computeFicoScore(rawScore, uDrift);
const roundedScore = Math.round(finalScore);

console.log('\n--- Final Rescored Values ---');
console.log({
  rawScore,
  netOutstandingUSD,
  uDrift,
  P: paymentHistoryFactor(rawScore),
  U: utilizationFactor(uDrift),
  finalScore,
  roundedScore,
});

await client.query(
  'UPDATE "public"."registeredWallet" SET "rawScore" = $1, "netOutstandingUSD" = $2, "uDrift" = $3, "lastCheckpointAt" = $4, "points" = $5 WHERE "wallet" ILIKE $6',
  [rawScore, netOutstandingUSD, uDrift, lastCheckpointAt, roundedScore, '%b8552e%']
);

console.log(`\nSuccessfully updated user wallet in registeredWallet table! New points = ${roundedScore}`);

// Verify current table state
const { rows: remaining } = await client.query('SELECT "id", "wallet", "points", "rawScore", "netOutstandingUSD", "uDrift" FROM "public"."registeredWallet"');
console.log('\nCurrent registeredWallet table:');
console.table(remaining);

await client.end();
