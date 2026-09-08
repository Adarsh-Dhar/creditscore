/**
 * Realtime entrypoint: one long-running Node process that polls every
 * POLL_INTERVAL_MS (default 60 s) instead of using ethers.js live listeners.
 *
 * Why polling instead of listeners?
 *   ethers.js listeners fire one callback per event. When a 60-second window
 *   accumulates many events, all callbacks execute simultaneously and each
 *   issues its own provider.getTransaction() + provider.getBlock() call,
 *   producing a burst of 30+ concurrent RPC requests that immediately trips
 *   Infura's rate limiter (-32005 Too Many Requests) and crashes the process.
 *
 *   Polling runs a single controlled batch of queryFilter calls once per
 *   interval — the same code path as `npm run index` — so the RPC budget is
 *   bounded and predictable regardless of how many events landed in the window.
 *
 * Pipeline:
 *   poll (runOnce every 60 s) -> index (decode + upsert) -> prove (attest + submit)
 *
 * Usage (from indexer/):
 *   npm run realtime
 *   POLL_INTERVAL_MS=30000 npm run realtime   # poll every 30 s
 *   PROVE_MODE=batch npm run realtime
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "../db/.env"), override: false });

import { db } from "creditscore-db";
import { runOnce } from "./index.js";
import { startProver } from "./prove.js";
import { disconnect } from "./store.js";

// How long to wait between the end of one poll and the start of the next.
// Keeping this at ≥ 60 s leaves plenty of headroom under Infura's free-tier
// rate limit (10 req/s, with bursts allowed up to the daily cap).
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);

async function main(): Promise<void> {
  console.log("Connecting to database...");
  const runtime = await db.connect({ url: process.env.DATABASE_URL! });
  console.log("Database connected successfully");

  // Start prover before the first poll so any rows it upserts are immediately queued.
  startProver();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutdown requested, draining...");
    disconnect()
      .then(() => runtime.close())
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(`\n=== poll -> index -> prove pipeline running (every ${POLL_INTERVAL_MS / 1000}s). Ctrl+C to stop. ===\n`);

  // Run immediately, then schedule repeating polls.
  // Using a loop with setTimeout (rather than setInterval) ensures the next
  // poll never starts until the current one is fully done — preventing overlap
  // if a scan takes longer than the interval.
  const poll = async (): Promise<void> => {
    if (shuttingDown) return;
    const start = Date.now();
    try {
      await runOnce({});
    } catch (err: any) {
      console.error(`[poll] runOnce error: ${err.message}`);
    }
    if (shuttingDown) return;
    const elapsed = Date.now() - start;
    const wait = Math.max(0, POLL_INTERVAL_MS - elapsed);
    console.log(`[poll] next scan in ${Math.round(wait / 1000)}s`);
    setTimeout(poll, wait);
  };

  await poll();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
