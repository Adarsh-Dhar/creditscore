import type { Result } from "ethers";
export interface AssetAndAmount {
    asset: string | null;
    amount: string | null;
}
export declare function extractWallet(eventName: string, args: Result): string | null;
export declare function extractAssetAndAmount(eventName: string, args: Result): AssetAndAmount;
