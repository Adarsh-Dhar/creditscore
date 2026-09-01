/**
 * Indexer entrypoint. Scans Aave V3's Pool contract on Ethereum Sepolia for
 * Supply/Borrow/Repay/Withdraw/LiquidationCall events, for any wallet, and
 * appends newly-seen ones to data/events.json.
 *
 * This does discovery only. It does NOT generate or submit proofs — that's
 * the main repo's generateAndSubmitProof.js, driven by SOURCE_TX_HASH.
 * See README.md for how the two connect.
 *
 * Usage:
 *   npm run index                            # scan from checkpoint (or START_BLOCK) to latest
 *   npm run index -- --from-block 1234567    # override checkpoint, re-scan from this block
 *   npm run index:watch                      # backfill from checkpoint, then live-listen for new events
 */
export interface IndexSingleTxParams {
    txHash: string;
    chain: string;
    protocol: string;
    sourceRpc: string;
    expectedWallet?: string;
    eventName?: string;
    proven?: boolean;
}
export declare function indexSingleTx({ txHash, chain, protocol, sourceRpc, expectedWallet, eventName, proven, }: IndexSingleTxParams): Promise<{
    amount: string;
    asset: string | null;
    id: number;
    txHash: string;
    logIndex: number;
    blockNumber: number;
    eventName: string;
    wallet: string;
    chain: string;
    protocol: string;
    timestamp: number | null;
    proven: boolean;
    createdAt: Date;
} | null>;
