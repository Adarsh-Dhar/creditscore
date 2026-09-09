#!/usr/bin/env node
/**
 * Raw SQL migration — creates all tables, indexes, and constraints.
 *
 * Why raw SQL instead of `prisma db migrate`:
 *   prisma db migrate (v8 RC) exits 0 even on failure, silently skipping
 *   the migration in CI. This script uses pg directly, is idempotent
 *   (IF NOT EXISTS everywhere), and exits 1 on any error.
 *
 * Usage:
 *   node scripts/migrate.mjs
 *   DATABASE_URL=postgresql://... node scripts/migrate.mjs
 */

import pg from 'pg';

const { Client } = pg;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const client = new Client({ connectionString: url });

const steps = [
  {
    name: 'Create schema public',
    sql: `CREATE SCHEMA IF NOT EXISTS "public"`,
  },
  {
    name: 'Create table indexedEvent',
    sql: `
      CREATE TABLE IF NOT EXISTS "public"."indexedEvent" (
        "amount"      text        NOT NULL,
        "asset"       text,
        "blockNumber" int4        NOT NULL,
        "chain"       text        NOT NULL DEFAULT 'sepolia',
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        "eventName"   text        NOT NULL,
        "id"          SERIAL      NOT NULL,
        "logIndex"    int4        NOT NULL,
        "protocol"    text        NOT NULL DEFAULT 'aave',
        "proven"      bool        NOT NULL DEFAULT false,
        "timestamp"   int4,
        "txHash"      text        NOT NULL,
        "wallet"      text        NOT NULL,
        PRIMARY KEY ("id")
      )
    `,
  },
  {
    name: 'Create table indexerCheckpoint',
    sql: `
      CREATE TABLE IF NOT EXISTS "public"."indexerCheckpoint" (
        "chain"            text        NOT NULL,
        "contractAddress"  text        NOT NULL,
        "id"               SERIAL      NOT NULL,
        "lastIndexedBlock" int4        NOT NULL,
        "updatedAt"        timestamptz NOT NULL,
        PRIMARY KEY ("id")
      )
    `,
  },
  {
    name: 'Create table registeredWallet',
    sql: `
      CREATE TABLE IF NOT EXISTS "public"."registeredWallet" (
        "createdAt"  timestamptz NOT NULL DEFAULT now(),
        "id"         SERIAL      NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        "points"     int4        NOT NULL DEFAULT 0,
        "wallet"     text        NOT NULL,
        PRIMARY KEY ("id")
      )
    `,
  },
  {
    name: 'Unique constraint indexedEvent(txHash, logIndex)',
    sql: `
      ALTER TABLE "public"."indexedEvent"
        ADD CONSTRAINT "indexedEvent_txHash_logIndex_key" UNIQUE ("txHash", "logIndex")
    `,
    ifNotExists: true,
    checkSql: `
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'indexedEvent_txHash_logIndex_key'
          AND n.nspname = 'public'
      ) AS exists
    `,
  },
  {
    name: 'Unique constraint indexerCheckpoint(chain, contractAddress)',
    sql: `
      ALTER TABLE "public"."indexerCheckpoint"
        ADD CONSTRAINT "indexerCheckpoint_chain_contractAddress_key" UNIQUE ("chain", "contractAddress")
    `,
    checkSql: `
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'indexerCheckpoint_chain_contractAddress_key'
          AND n.nspname = 'public'
      ) AS exists
    `,
  },
  {
    name: 'Unique constraint registeredWallet(wallet)',
    sql: `
      ALTER TABLE "public"."registeredWallet"
        ADD CONSTRAINT "registeredWallet_wallet_key" UNIQUE ("wallet")
    `,
    checkSql: `
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'registeredWallet_wallet_key'
          AND n.nspname = 'public'
      ) AS exists
    `,
  },
  {
    name: 'Index indexedEvent(protocol)',
    sql: `CREATE INDEX IF NOT EXISTS "indexedEvent_protocol_idx_ccac2c0a" ON "public"."indexedEvent" ("protocol")`,
  },
  {
    name: 'Index indexedEvent(proven)',
    sql: `CREATE INDEX IF NOT EXISTS "indexedEvent_proven_idx_0df99ddc"   ON "public"."indexedEvent" ("proven")`,
  },
  {
    name: 'Index indexedEvent(wallet)',
    sql: `CREATE INDEX IF NOT EXISTS "indexedEvent_wallet_idx_df52cf87"   ON "public"."indexedEvent" ("wallet")`,
  },
  {
    name: 'Add rawScore to registeredWallet',
    sql: `ALTER TABLE "public"."registeredWallet" ADD COLUMN IF NOT EXISTS "rawScore" float8 NOT NULL DEFAULT 0`,
  },
  {
    name: 'Create table aiScoreLog',
    sql: `
      CREATE TABLE IF NOT EXISTS "public"."aiScoreLog" (
        "id"              SERIAL      NOT NULL,
        "wallet"          text        NOT NULL,
        "eventName"       text        NOT NULL,
        "importance"      int4        NOT NULL,
        "reasoning"       text        NOT NULL,
        "rawDelta"        float8      NOT NULL,
        "newRawScore"     float8      NOT NULL,
        "newDisplayScore" float8      NOT NULL,
        "createdAt"       timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("id")
      )
    `,
  },
  {
    name: 'Index aiScoreLog(wallet)',
    sql: `CREATE INDEX IF NOT EXISTS "aiScoreLog_wallet_idx" ON "public"."aiScoreLog" ("wallet")`,
  },
  {
    name: 'Add netOutstandingUSD to registeredWallet',
    sql: `ALTER TABLE "public"."registeredWallet" ADD COLUMN IF NOT EXISTS "netOutstandingUSD" float8 NOT NULL DEFAULT 0`,
  },
  {
    name: 'Add uDrift to registeredWallet',
    sql: `ALTER TABLE "public"."registeredWallet" ADD COLUMN IF NOT EXISTS "uDrift" float8 NOT NULL DEFAULT 0`,
  },
  {
    name: 'Add lastCheckpointAt to registeredWallet',
    sql: `ALTER TABLE "public"."registeredWallet" ADD COLUMN IF NOT EXISTS "lastCheckpointAt" int4 NOT NULL DEFAULT 0`,
  },
];

async function run() {
  console.log('Connecting to database...');
  await client.connect();
  console.log('Connected.\n');

  for (const step of steps) {
    // For ALTER TABLE constraints, check first to avoid duplicate errors
    if (step.checkSql) {
      const { rows } = await client.query(step.checkSql);
      if (rows[0].exists) {
        console.log(`  ✓ skip  ${step.name} (already exists)`);
        continue;
      }
    }

    process.stdout.write(`  →       ${step.name} ... `);
    await client.query(step.sql);
    console.log('done');
  }

  console.log('\nAll migrations applied successfully.');
}

run()
  .catch((err) => {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  })
  .finally(() => client.end());
