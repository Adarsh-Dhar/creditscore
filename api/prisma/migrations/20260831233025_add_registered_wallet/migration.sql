-- Create RegisteredWallet table
CREATE TABLE "RegisteredWallet" (
    "id" SERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RegisteredWallet_pkey" PRIMARY KEY ("id")
);

-- Create unique index on wallet
CREATE UNIQUE INDEX "RegisteredWallet_wallet_key" ON "RegisteredWallet"("wallet");
