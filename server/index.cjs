/**
 * server/index.cjs
 *
 * Thin Express server that exposes one POST route per protocol operation.
 * All heavy lifting lives in the service modules; this file is just routing
 * and error formatting.
 *
 * Routes:
 *   POST /aave/:operation        supply | borrow | repay | withdraw | add-collateral | remove-collateral
 *   POST /compound/:operation    supply-base | supply-collateral | withdraw-base | withdraw-collateral
 *   POST /liquity/:operation     open | add-coll | withdraw-coll | withdraw-bold | repay-bold | close
 *   GET  /health
 *
 * Every successful response:  { ok: true, txHash, blockNumber, operation, ...extra }
 * Every error response:       { ok: false, error: "<message>" }
 *
 * Start:  node server/index.cjs
 * Port:   TX_SERVER_PORT env var, default 3002
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const aave = require("./lib/aaveService.cjs");
const compound = require("./lib/compoundService.cjs");
const liquity = require("./lib/liquityService.cjs");

const app = express();
const PORT = Number(process.env.TX_SERVER_PORT || 3002);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Request queue (one tx at a time — single wallet, single nonce stream) ────
let busy = false;
const queue = [];

function runNext() {
  if (busy || queue.length === 0) return;
  busy = true;
  const { fn, resolve, reject } = queue.shift();
  fn()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      busy = false;
      runNext();
    });
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    runNext();
  });
}

// ── Handler factory ───────────────────────────────────────────────────────────
function handle(serviceFn) {
  return async (req, res) => {
    try {
      const result = await enqueue(() => serviceFn(req.body || {}));
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error(`[tx-server] error:`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  };
}

// ── Aave routes ───────────────────────────────────────────────────────────────
app.post("/aave/supply",             handle(aave.supply));
app.post("/aave/borrow",             handle(aave.borrow));
app.post("/aave/repay",              handle(aave.repay));
app.post("/aave/withdraw",           handle(aave.withdraw));
app.post("/aave/add-collateral",     handle(aave.addCollateral));
app.post("/aave/remove-collateral",  handle(aave.removeCollateral));

// ── Compound routes ───────────────────────────────────────────────────────────
app.post("/compound/supply-base",          handle(compound.supplyBase));
app.post("/compound/supply-collateral",    handle(compound.supplyCollateral));
app.post("/compound/withdraw-base",        handle(compound.withdrawBase));
app.post("/compound/withdraw-collateral",  handle(compound.withdrawCollateral));

// ── Liquity routes ────────────────────────────────────────────────────────────
app.post("/liquity/open",          handle(liquity.open));
app.post("/liquity/add-coll",      handle(liquity.addColl));
app.post("/liquity/withdraw-coll", handle(liquity.withdrawColl));
app.post("/liquity/withdraw-bold", handle(liquity.withdrawBold));
app.post("/liquity/repay-bold",    handle(liquity.repayBold));
app.post("/liquity/close",         handle(liquity.close));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    queueLength: queue.length,
    busy,
    env: {
      SEPOLIA_RPC: !!process.env.SEPOLIA_RPC,
      PRIVATE_KEY: !!process.env.PRIVATE_KEY,
      AAVE_SEPOLIA_POOL: !!process.env.AAVE_SEPOLIA_POOL,
      COMPOUND_SEPOLIA_COMET_USDC: !!process.env.COMPOUND_SEPOLIA_COMET_USDC,
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[tx-server] listening on http://localhost:${PORT}`);
  const missing = ["SEPOLIA_RPC", "PRIVATE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.warn(`[tx-server] ⚠ missing env vars: ${missing.join(", ")}`);
  }
});
