# creditscore-indexer

Off-chain indexer for the CreditScoreMVP project. Scans Aave V3's Pool
contract on Ethereum Sepolia for `Supply` / `Borrow` / `Repay` / `Withdraw` /
`LiquidationCall` events (any wallet), checkpoints progress, and writes
results to `data/events.json` as candidates for the main repo's proof step.

This package does discovery only. It does not call Attestcoin, generate
proofs, or touch Creditcoin — that stays in `generateAndSubmitProof.js` in
the main `creditscore-main` repo.

## Setup

```bash
cd indexer
npm install
cp .env.example .env
# fill in SEPOLIA_RPC
```

**RPC Provider Notes:**
- Infura free tier is heavily rate-limited. You may see "Too Many Requests" errors.
- Consider using Alchemy, QuickNode, or other providers for better reliability.
- The indexer includes automatic retry logic with exponential backoff for rate limits.
- If rate limiting persists, reduce `INDEXER_CHUNK_SIZE` in `.env` (default: 5000).

## Run

```bash
npm run index
```

First run with no `START_BLOCK` set starts from the current chain tip
(not genesis — see main repo docs Section 4.3 on why forward-only indexing
is the intended design). Every run after that resumes from
`data/checkpoint.json`.

To re-scan a specific range regardless of checkpoint:

```bash
npm run index -- --from-block 1234567
```

## Output

`data/events.json` — array of:

```json
{
  "txHash": "0x...",
  "logIndex": 3,
  "blockNumber": 1234567,
  "eventName": "Borrow",
  "wallet": "0x...",
  "asset": "0x...",
  "amount": "1000000",
  "chain": "sepolia",
  "timestamp": 1234567890,
  "proven": false
}
```

`data/checkpoint.json` — `{ "lastIndexedBlock": 1234567 }`

Both files are gitignored — this is local run state, not source.

## Integrating with the main repo

See the parent project's `generateAndSubmitProof.js`. This indexer replaces
the manual step of finding a `SOURCE_TX_HASH` yourself:

1. Run this indexer.
2. Read `data/events.json`, pick an entry with `"proven": false`.
3. Set that entry's `txHash` as `SOURCE_TX_HASH` in the main repo's `.env`.
4. Run `npm run prove` in the main repo.
5. On success, manually set that event's `"proven": true` in
   `data/events.json` (or write a small script to do it — not included here,
   since the main repo proves one tx at a time and doesn't report back to
   this package automatically).

This package intentionally has no dependency on the main repo and vice
versa — keep them as separate npm projects unless you want to merge them
into one monorepo (see integration options in the delivery message).
