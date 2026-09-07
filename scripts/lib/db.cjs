/**
 * db.cjs
 *
 * Thin CommonJS wrapper around raw pg queries for use by the CJS prove scripts.
 * Replaces the ESM-only `creditscore-db` / `indexer/src/store` imports that
 * cannot be require()'d from a .cjs context.
 *
 * Implements only the subset of store functions used by proveQueue and
 * generateAndSubmitProof:
 *   loadUnprovenEvents(limit, chain?, protocol?)
 *   loadEventByTxHash(txHash)
 *   markProven(txHash)
 *   disconnect()
 */

"use strict";
require("dotenv").config();
const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set in .env");
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

/**
 * Load up to `limit` unproven IndexedEvent rows, oldest block first.
 * Optionally filter by chain and/or protocol.
 */
async function loadUnprovenEvents(limit = 10, chain = null, protocol = null) {
  const db = getPool();
  const params = [false, limit];
  let whereExtra = "";
  if (chain) {
    params.push(chain);
    whereExtra += ` AND chain = $${params.length}`;
  }
  if (protocol) {
    params.push(protocol);
    whereExtra += ` AND protocol = $${params.length}`;
  }
  const sql = `
    SELECT * FROM "indexedEvent"
    WHERE proven = $1${whereExtra}
    ORDER BY "blockNumber" ASC, "logIndex" ASC
    LIMIT $2
  `;
  const { rows } = await db.query(sql, params);
  return rows;
}

/**
 * Load a single IndexedEvent by txHash (case-insensitive).
 */
async function loadEventByTxHash(txHash) {
  if (!txHash) return null;
  const db = getPool();
  const { rows } = await db.query(
    `SELECT * FROM "indexedEvent" WHERE lower("txHash") = lower($1) LIMIT 1`,
    [txHash]
  );
  return rows[0] || null;
}

/**
 * Mark all IndexedEvent rows with this txHash as proven.
 */
async function markProven(txHash) {
  const db = getPool();
  await db.query(
    `UPDATE "indexedEvent" SET proven = true WHERE lower("txHash") = lower($1)`,
    [txHash]
  );
}

/**
 * Close the pg pool (no-op if never opened).
 */
async function disconnect() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}

module.exports = { loadUnprovenEvents, loadEventByTxHash, markProven, disconnect };
