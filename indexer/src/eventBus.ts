/**
 * In-process event bus wiring the three pipeline stages together:
 *   watch -> index -> prove
 *
 * watch.ts and index.ts are still a direct function call (they're tightly
 * coupled: a raw log has no meaning until it's decoded). The only stage that
 * genuinely needs decoupling is index -> prove, since proving is slow
 * (waits on chain attestation + an external prover API) and must never block
 * the watcher from picking up the next log. store.ts emits INDEXED right
 * after any new, unproven row is written — from live watching, one-shot
 * `npm run index`, or backfill — so every code path feeds the prover the
 * same way.
 */
import { EventEmitter } from "node:events";
import type { IndexedEventRow } from "./store.js";

export const EVENTS = {
  INDEXED: "indexed-event",
} as const;

class Bus extends EventEmitter {}
export const bus = new Bus();

export function emitIndexed(row: IndexedEventRow): void {
  bus.emit(EVENTS.INDEXED, row);
}
