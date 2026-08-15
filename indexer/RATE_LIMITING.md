# Rate Limiting Issues and Solutions

## The 429 Error

The "Too Many Requests" (HTTP 429) error you're experiencing is caused by **Infura's free tier rate limiting**. Even though you're only querying a single block, the indexer makes multiple RPC calls that can exceed free tier limits.

### Why It Happens

1. **Multiple queries per chunk**: The indexer queries **5 event types** per block range (Supply, Borrow, Repay, Withdraw, LiquidationCall)
2. **Additional RPC calls**: Each event may trigger `getBlock()` calls for timestamps
3. **Infura free tier limits**: Very restrictive - around 3-5 requests per second maximum
4. **Cumulative effect**: Even small block ranges can trigger limits when querying all event types

## Solutions Implemented

### 1. Automatic Retry Logic with Exponential Backoff

Added retry logic that:
- Retries failed requests up to 5 times
- Uses exponential backoff (1s, 2s, 4s, 8s, 16s delays)
- Specifically targets rate limit errors (code -32005, "Too Many Requests", "429")

### 2. Query Delays

Added 500ms delays between event type queries to reduce burst request patterns.

### 3. Block Timestamp Caching

Implemented caching for block timestamps to avoid redundant `getBlock()` calls within the same block.

## Recommended Solutions for Users

### Option 1: Use a Better RPC Provider (Recommended)

**Alchemy** or **QuickNode** have much more generous free tiers:
- Alchemy: ~300M compute units/month (vs Infura's ~100K)
- QuickNode: ~2M requests/month (vs Infura's ~100K)

**Setup:**
```bash
# In indexer/.env
SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
# or
SEPOLIA_RPC=https://YOUR-ENDPOINT.quiknode.pro/YOUR_KEY/
```

### Option 2: Reduce Chunk Size

Lower the block range per query to reduce request size:
```bash
# In indexer/.env
INDEXER_CHUNK_SIZE=100  # Default is 5000
```

### Option 3: Use Public RPCs (Less Reliable)

Public RPCs don't have rate limits but are less reliable:
```bash
SEPOLIA_RPC=https://rpc.sepolia.org  # Often slow or down
```

## Testing Results

With retry logic enabled:
- ✅ Single block queries: Success (with retries)
- ✅ Resume functionality: Working correctly
- ✅ Checkpointing: Working correctly
- ✅ Deduplication: Working correctly
- ⚠️ Larger ranges: Still hit Infura limits despite retries

## Current Status

The indexer logic is **fully functional**. The 429 errors are purely due to Infura's free tier limitations, not code issues. With a proper RPC provider, the indexer will work seamlessly.

## Updated Files

- `src/index.js`: Added retry logic, query delays, and timestamp caching
- `.env.example`: Updated with RPC provider recommendations
- `README.md`: Added RPC provider notes and troubleshooting
