-- CreateTable
CREATE TABLE "IndexedEvent" (
    "id" SERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "asset" TEXT,
    "amount" TEXT NOT NULL,
    "chain" TEXT NOT NULL DEFAULT 'sepolia',
    "timestamp" INTEGER,
    "proven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCheckpoint" (
    "id" SERIAL NOT NULL,
    "chain" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "lastIndexedBlock" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexedEvent_wallet_idx" ON "IndexedEvent"("wallet");

-- CreateIndex
CREATE INDEX "IndexedEvent_proven_idx" ON "IndexedEvent"("proven");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedEvent_txHash_logIndex_key" ON "IndexedEvent"("txHash", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "IndexerCheckpoint_chain_contractAddress_key" ON "IndexerCheckpoint"("chain", "contractAddress");
