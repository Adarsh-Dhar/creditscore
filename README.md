# CreditScoreMVP — Run Guide

This is the minimal proof-of-concept: prove that **one real transaction on Ethereum
Sepolia actually happened**, using Creditcoin's Attestcoin Protocol, and watch a
score on a Creditcoin contract increase as a result. No frontend, no database,
no multi-protocol support — just the core mechanism, working end-to-end.

If this runs successfully, you've demonstrated the entire capability the bigger
project depends on.

---

## What's in this folder

```
creditscore-mvp/
├── contracts/
│   └── CreditScoreMVP.sol       # the on-chain verifier + score contract
├── scripts/
│   ├── deploy.js                 # deploys the contract to CC3 Testnet
│   ├── generateAndSubmitProof.js # the main demo script
│   ├── checkScore.js             # reads back a wallet's score anytime
│   ├── proveQueue.js             # batch-proves queued events from the indexer
│   └── lib/
│       └── proveBatch.js         # batch proof generation helper
├── indexer/
│   ├── src/
│   │   ├── config.js             # indexer configuration
│   │   └── index.js              # main indexer logic
│   └── package.json
├── hardhat.config.js
├── package.json
├── .env.example                  # copy to .env and fill in
└── README.md                     # this file
```

---

## Before you start — accounts and funds you need

1. **A wallet with a private key** you control (any EVM wallet — MetaMask export works).
   This same key will be used on both Sepolia and Creditcoin CC3 Testnet.
2. **Sepolia ETH** in that wallet — only needed if you want to *create* a fresh Aave
   transaction yourself. If you're just proving an existing transaction someone
   else made, you don't need Sepolia funds at all.
3. **CC3 Testnet CTC** in that wallet — needed to pay gas for deploying the
   contract and calling it. Get this from Creditcoin's testnet faucet
   (search "Creditcoin CC3 testnet faucet" or check docs.creditcoin.org for
   the current link — faucet URLs change).
4. **An Ethereum Sepolia RPC URL** — free tier from Infura, Alchemy, or any
   public Sepolia RPC.
5. **One Sepolia transaction hash to prove.** Easiest options:
   - Go to Aave's Sepolia testnet market UI, connect a wallet with Sepolia ETH,
     do one small supply/borrow/repay action yourself, and copy the resulting
     tx hash.
   - Or find any existing Aave Sepolia transaction on a Sepolia block explorer
     (e.g. sepolia.etherscan.io) — for the MVP demo, the transaction doesn't
     need to belong to your own wallet, since the contract lets you pass in
     any `wallet` address to credit.

---

## Step-by-step

### 1. Install dependencies

```bash
cd creditscore-mvp
npm install
```

### 2. Set up your environment

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `PRIVATE_KEY` — your wallet's private key
- `SEPOLIA_RPC` — your Sepolia RPC URL
- `CC3_TESTNET_RPC` — Creditcoin CC3 Testnet RPC (verify current URL against
  docs.creditcoin.org before running — this has changed before)
- `PROVER_API_URL` — Attestcoin proof generation API URL (also verify current
  value against docs)
- `SOURCE_TX_HASH` — the Sepolia transaction hash you're proving
- `TARGET_WALLET` — the address you want credited with score (can be your own)

Leave `CONTRACT_ADDRESS` blank for now — you'll fill it in after step 3.

### 3. Compile and deploy the contract

```bash
npm run compile
npm run deploy
```

This prints the deployed contract address. Copy it into `.env` as
`CONTRACT_ADDRESS`.

> Before deploying, double-check `VERIFIER` in `CreditScoreMVP.sol` still
> matches the current Attestcoin precompile address in the docs — this is
> the single most likely thing to have changed since this was written.

### 4. Check the starting score (should be 0)

```bash
npm run check-score
```

### 5. Run the main demo

```bash
npm run prove
```

This will:
- Look up Creditcoin's currently supported chains and find Sepolia's `chainKey`
- Find which block your transaction is in
- Wait until Creditcoin has attested that block (this can take a few minutes —
  the script polls automatically)
- Generate a Merkle + continuity proof for the transaction
- Submit the proof to your deployed contract
- Print the score before and after

You're looking for:

```
Score before: 0
...
Score after: 10

✅ SUCCESS — score increased. The Sepolia transaction was cryptographically
verified via Attestcoin and reflected on Creditcoin.
```

### 6. (Optional) Verify again anytime

```bash
npm run check-score
```

### 7. (Optional) Prove a batch of queued events

If you've run the indexer (`npm run index` in `indexer/`) and it found
multiple unproven Aave events across wallets, you don't have to prove them
one at a time by hand. Instead:

```bash
npm run prove-queue
```

This pulls up to `PROVE_BATCH_SIZE` (default 10, set in `.env`) unproven
events from the indexer's Postgres database, oldest block first, and proves
each one using its own wallet and event type — no `SOURCE_TX_HASH` /
`TARGET_WALLET` needed for this path. Each event is marked proven in
Postgres immediately after a successful on-chain submission. If one event
fails, it's logged and the run continues with the rest of the batch (no
retry/backoff — this is still a manually- or cron-triggered script, not a
long-running service).

---

## If something breaks

- **`getSupportedChains()` doesn't return Sepolia, or returns something
  unexpected** — the testnet has migrated infrastructure before (USC v2 →
  CC3 Testnet). Check the current SDK docs/examples at
  `docs.creditcoin.org/usc/dapp-builder-infrastructure/usc-sdk` for the
  current expected chain list and RPC endpoints.
- **`waitUntilHeightAttested` times out** — your transaction's block may not
  be attested yet, or attestor coverage may lag. Try a transaction from a
  more recent block, or increase the timeout in the script.
- **SDK method names don't match** (`ProverAPIProofGenerator`,
  `PrecompileChainInfoProvider`, etc. throw "not a constructor" or similar) —
  the `@gluwa/usc-sdk` package version may have changed its API since this
  was written. Run `npm view @gluwa/usc-sdk` and check its README/changelog,
  then adjust the import/method names in `scripts/generateAndSubmitProof.js`
  accordingly — the overall flow (get chain info → find block → wait for
  attestation → generate proof → submit) should still be correct even if
  exact names differ.
- **Verification reverts on-chain (`"verification failed"`)** — double check
  the `VERIFIER` precompile address in the contract matches current docs, and
  that you're passing the exact proof fields the precompile expects (field
  order/types can differ slightly by SDK version — log `proof` before
  submitting and compare against the SDK's example usage).

---

## What this does and doesn't prove

**Proves:** the core mechanism works — a specific transaction on an external
chain (Sepolia) can be cryptographically verified through Creditcoin's
Attestcoin Protocol, and a Creditcoin contract can act on that verification
(here, incrementing a score).

**Doesn't yet include** (intentionally, for MVP speed): decoding
Aave-specific transaction data (this just proves *a* transaction happened,
not that it was specifically a repay of a specific amount), multiple
protocols, an indexer to find transactions automatically, a scoring formula,
a database, or a frontend. Those are the next build phases once this core
loop is proven to someone.

---

## Selector Coverage

The contract currently supports the following Aave V3 Pool function selectors:

- `supply(address,uint256,address,uint16)` → EventType.Supply
- `supplyWithPermit(address,uint256,uint16,uint256,uint8,bytes32,bytes32)` → EventType.Supply
- `borrow(address,uint256,uint256,uint16,address)` → EventType.Borrow
- `repay(address,uint256,uint256,address)` → EventType.Repay
- `repayWithPermit(address,uint256,uint256,uint16,uint256,uint8,bytes32,bytes32)` → EventType.Repay
- `repayWithATokens(address,uint256,uint256,uint16,address)` → EventType.Repay
- `withdraw(address,uint256,address)` → EventType.Withdraw
- `liquidationCall(address,address,address,uint256,bool)` → EventType.LiquidationCall

**Known gap:** WETHGateway operations (e.g., `depositETH`, `withdrawETH`) are not currently supported. These transactions target the WETHGateway contract rather than the Pool directly, so they bypass the selector-based decoding. Future versions could extend support by adding WETHGateway selectors and/or additional target address checks.
