-- AlterTable
ALTER TABLE "IndexedEvent" ADD COLUMN     "protocol" TEXT NOT NULL DEFAULT 'aave';

-- CreateIndex
CREATE INDEX "IndexedEvent_protocol_idx" ON "IndexedEvent"("protocol");
