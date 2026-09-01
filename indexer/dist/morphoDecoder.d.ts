import type { Result } from "ethers";
import type { AssetAndAmount } from "./aaveDecoder";
export declare function extractWallet(eventName: string, args: Result): string | null;
export declare function extractAssetAndAmount(eventName: string, args: Result): AssetAndAmount;
