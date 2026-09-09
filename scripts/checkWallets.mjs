#!/usr/bin/env node
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

console.log('Checking wallet data...\n');

const { rows } = await client.query('SELECT "wallet", "points", "rawScore", "netOutstandingUSD", "uDrift", "lastCheckpointAt" FROM "public"."registeredWallet" ORDER BY "points" DESC LIMIT 10');

console.log('Top 10 wallets by score:');
console.table(rows);

console.log('\n--- Detailed breakdown for wallet 0xb8552e...FB863C ---');
const { rows: [wallet] } = await client.query('SELECT * FROM "public"."registeredWallet" WHERE wallet ILIKE $1', ['%b8552e%']);
if (wallet) {
  console.log('Wallet data:', wallet);
} else {
  console.log('Wallet not found');
}

console.log('\n--- Recent events for this wallet ---');
const { rows: events } = await client.query('SELECT "eventName", "amount", "asset", "timestamp" FROM "public"."indexedEvent" WHERE "wallet" ILIKE $1 ORDER BY "blockNumber" DESC LIMIT 10', ['%b8552e%']);
console.table(events);

await client.end();
