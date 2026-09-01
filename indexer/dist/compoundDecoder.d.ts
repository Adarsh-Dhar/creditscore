import type { Result } from "ethers";
import type { AssetAndAmount } from "./aaveDecoder";
export declare function getBaseAssetAddress(chain: string): string | null;
export declare function setBaseAssetAddress(chain: string, address: string): void;
export declare function extractWallet(eventName: string, args: Result): string | null;
export declare function extractAssetAndAmount(eventName: string, args: Result, chain: string): AssetAndAmount;
export declare function classifyCompoundEvent(eventName: string, assetAddress: string | null, chain: string): string;
