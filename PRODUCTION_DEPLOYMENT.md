# Production Deployment Guide

This guide covers deploying the creditscore API and indexer out of localhost. All commands in §3 and §4 were verified against the actual repo.

---

## 1. Architecture overview

| Service | What it does | Instances |
|---------|-------------|-----------|
| **API** (`api/`) | Read-only Express server. Serves `/api/wallets`, `/api/leaderboard`, `/api/chains`, `/api/queue`, `/api/weights`, `/api/health` | Any number |
| **Indexer** (`indexer/`) | Polls chain events, writes to Postgres, submits ZK proofs | **Exactly 1** — see §1.1 |
| **Database** | Postgres (Neon recommended) | 1 shared instance |

### 1.1 Why exactly one indexer instance

The indexer's `prove.ts` uses a serialized single-nonce queue. Running two indexers simultaneously causes nonce collisions on the prover wallet — proofs get dropped silently. Use a single worker process with a restart policy, never a replica set.

---

## 2. Database (Neon — free tier works)

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **pooled** connection string (ends with `-pooler.region.aws.neon.tech/neondb`). It must include `?sslmode=require`.
3. Run the schema migration once from your local machine:

```bash
# From repo root
DATABASE_URL="postgresql://..." npx prisma db push --schema db/src/prisma/contract.prisma
```

> **Note:** This project uses Prisma Next (`@prisma/orm-postgres` 8.x RC), not classic Prisma. The commands `prisma migrate deploy` and `prisma generate` from standard Prisma docs **do not exist** in this version. Use `prisma db push` or `prisma db migrate` as shown above.

---

## 3. Deploying the API on Render

### 3.1 What broke before (and the fix)

Two bugs caused an immediate crash on any platform running plain `node` (Render, Railway, Fly, Docker):

**Bug 1 — `creditscore-db` exported a `.ts` source file**
`db/package.json` had `"import": "./src/prisma/db.ts"`. Node.js cannot execute `.ts` files directly. This caused:
```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
```
**Fixed:** `db/package.json` now exports `"import": "./src/prisma/db.js"` (the pre-compiled JS file that already existed at that path).

**Bug 2 — Dead `dotenv.config()` calls due to ESM hoisting**
In Node ESM, static `import` statements are hoisted and evaluated depth-first before any top-level code in the importing module runs. The `dotenv.config()` call in `api/src/index.ts` and `api/src/db.ts` fired *after* `creditscore-db` had already initialised. On Render there's no `.env` file anyway — env vars come from the dashboard and are already in `process.env` before Node starts.
**Fixed:** Removed the dead `dotenv.config()` calls. `creditscore-db`'s own `import 'dotenv/config'` (which runs as part of its module evaluation) handles local development.

### 3.2 Create the Render service

1. [render.com](https://render.com) → New + → **Web Service** → connect your GitHub repo.
2. **Name:** `creditscore-api` (becomes `https://creditscore-api.onrender.com`).
3. **Language:** Node.
4. **Root Directory:** leave blank (repo root). Do **not** set it to `api/` — pnpm workspaces need `db/package.json` as a sibling at build time.
5. **Region:** closest to you.
6. **Branch:** `main`.

### 3.3 Build & Start commands

**Build Command:**
```
pnpm --filter creditscore-api... install --frozen-lockfile && pnpm --filter creditscore-api build
```

- `--filter creditscore-api...` (trailing `...`) installs `creditscore-api` and its workspace dependency `creditscore-db`.
- The second command compiles `api/src/` → `api/dist/` via `tsc`.
- `creditscore-db` does **not** need a separate build step — its `package.json` exports point at the pre-compiled `src/prisma/db.js`.

**Start Command:**
```
node api/dist/index.js
```

### 3.4 Environment variables

Add these in Render → your service → **Environment** tab. Mark secrets as "Secret" where available.

| Variable | Required | Notes |
|----------|----------|-------|
| `NODE_VERSION` | **required** | Set to `22`. Render's default is older; `@prisma/orm-postgres` RC requires Node ≥ 22. |
| `DATABASE_URL` | **required** | Neon pooled connection string. Must end with `?sslmode=require`. |
| `CONTRACT_ADDRESS` | **required** | Your deployed `CreditScoreMVP` contract address on CC3 Testnet. |
| `CC3_TESTNET_RPC` | **required** | RPC URL for CC3 Testnet (e.g. `https://rpc.cc3-testnet.creditcoin.network`). |
| `SEPOLIA_RPC` | **required** | Alchemy or Infura Sepolia endpoint. Alchemy free tier has better rate limits. |
| `CORS_ORIGINS` | **required** | Comma-separated allowed origins, e.g. `https://your-app.vercel.app`. If omitted, defaults to `http://localhost:3000` — all production browser requests will be blocked. |
| `NODE_ENV` | optional | `production` — controls error verbosity in responses. |
| `LEADERBOARD_MAX_WALLETS` | optional | Default `100`. |
| `PORT` | **do not set** | Render injects its own `$PORT`; your `index.ts` already reads it. |

> `PRIVATE_KEY`, `COMPOUND_SEPOLIA_COMET_USDC`, `MORPHO_BLUE_SEPOLIA_ADDRESS`, `AAVE_SEPOLIA_WETHGATEWAY` are **indexer-only** — skip them on the API service.

### 3.5 Instance type

Free tier is fine for the API (stateless, read-only). Note: free instances spin down after 15 minutes of inactivity; the first request after a cold start takes 30–60s. Hit `/api/health` once before a demo to warm it up.

### 3.6 Verify

```bash
curl https://creditscore-api.onrender.com/api/health
curl https://creditscore-api.onrender.com/api/leaderboard
```

### 3.7 Point the frontend at it

In Vercel → your project → Settings → Environment Variables:
```
NEXT_PUBLIC_API_URL=https://creditscore-api.onrender.com
```
Then **redeploy** the frontend — Vercel env var changes require a new build to take effect on already-deployed static output.

---

## 4. Deploying the Indexer

The indexer needs a persistent process that never stops — it must **not** run on a free-tier service that spins down.

### 4.1 Option A: Render Background Worker (paid, $7/mo)

1. New + → **Background Worker** → same repo.
2. **Root Directory:** blank.
3. **Build Command:**
```
pnpm --filter creditscore-indexer... install --frozen-lockfile && pnpm --filter creditscore-indexer build
```
4. **Start Command:**
```
node indexer/dist/index.js
```
5. **Environment variables** (in addition to the API ones):

| Variable | Notes |
|----------|-------|
| `PRIVATE_KEY` | Prover wallet private key (0x-prefixed). Mark as Secret. |
| `COMPOUND_SEPOLIA_COMET_USDC` | Compound V3 cUSDCv3 contract on Sepolia. |
| `MORPHO_BLUE_SEPOLIA_ADDRESS` | Morpho Blue contract on Sepolia. |
| `AAVE_SEPOLIA_WETHGATEWAY` | Aave V3 WETHGateway on Sepolia. |
| `PROOF_BUILDER_URL` | URL of the CC3 proof-builder service. |
| `DATABASE_URL` | Same Neon pooled URL as the API. |

6. Set **Max Instances: 1** in Render's scaling settings.

### 4.2 Option B: Fly.io (free allowance covers 1 small VM)

```bash
# from repo root
fly launch --name creditscore-indexer --dockerfile Dockerfile.indexer --no-deploy
fly secrets set PRIVATE_KEY=0x... DATABASE_URL=postgresql://...
fly scale count 1          # enforce single instance
fly deploy
```

### 4.3 Option C: Any VPS (DigitalOcean, Hetzner, etc.)

```bash
# on the server
git clone <your-repo> creditscore && cd creditscore
cp api/.env.example api/.env   # fill in real values
pnpm install
pnpm --filter creditscore-indexer build

# run with pm2 for auto-restart
npm install -g pm2
pm2 start node --name creditscore-indexer -- indexer/dist/index.js
pm2 save
pm2 startup
```

---

## 5. Single-VM Docker Compose (everything on one server)

If you want API + indexer on one machine:

```bash
# copy and fill in env vars
cp .env.example .env

# build and start
docker compose -f docker-compose.prod.yml up -d --build

# view logs
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f indexer
```

See `docker-compose.prod.yml`, `Dockerfile.api`, and `Dockerfile.indexer` in the repo root for the full configuration.

---

## 6. Quick checklist before going live

- [ ] `DATABASE_URL` is the **pooled** Neon connection string with `?sslmode=require`
- [ ] `CORS_ORIGINS` is set to your actual frontend domain (not localhost)
- [ ] `NODE_VERSION=22` is set on Render
- [ ] Indexer is running as **exactly 1 instance**
- [ ] `/api/health` returns `{"status":"ok","database":"configured"}`
- [ ] `/api/leaderboard` returns data (not an empty array with a 500)
- [ ] Frontend `NEXT_PUBLIC_API_URL` points at the deployed API, not localhost
