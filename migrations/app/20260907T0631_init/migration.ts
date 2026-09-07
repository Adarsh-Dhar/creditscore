#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/5c8e0c48d4a69680a9052cc930dc7647fa7a192e8d9707e69cd57cc9f61b8d0e/contract';
import endContract from '../../snapshots/5c8e0c48d4a69680a9052cc930dc7647fa7a192e8d9707e69cd57cc9f61b8d0e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'indexedEvent',
        columns: [
          col('amount', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('asset', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('blockNumber', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('chain', 'text', {
            notNull: true,
            default: lit('sepolia'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('eventName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('logIndex', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('protocol', 'text', {
            notNull: true,
            default: lit('aave'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('proven', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('timestamp', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('txHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('wallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'indexerCheckpoint',
        columns: [
          col('chain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('contractAddress', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastIndexedBlock', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'registeredWallet',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastSeenAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('points', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('wallet', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'indexedEvent',
        constraint: 'indexedEvent_txHash_logIndex_key',
        columns: ['txHash', 'logIndex'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'indexerCheckpoint',
        constraint: 'indexerCheckpoint_chain_contractAddress_key',
        columns: ['chain', 'contractAddress'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'registeredWallet',
        constraint: 'registeredWallet_wallet_key',
        columns: ['wallet'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'indexedEvent',
        index: 'indexedEvent_protocol_idx_ccac2c0a',
        columns: ['protocol'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'indexedEvent',
        index: 'indexedEvent_proven_idx_0df99ddc',
        columns: ['proven'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'indexedEvent',
        index: 'indexedEvent_wallet_idx_df52cf87',
        columns: ['wallet'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
