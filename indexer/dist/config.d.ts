export interface ProtocolConfig {
    id: string;
    poolAddress: string;
    abi: string[];
    wethGatewayAddress?: string;
    wethGatewayAbi?: string[];
}
export interface ChainConfig {
    name: string;
    rpcEnvVar: string;
    numericChainId: number;
    protocols: ProtocolConfig[];
}
export declare const AAVE_EVENT_ABI: string[];
export declare const AAVE_WETHGATEWAY_EVENT_ABI: string[];
export declare const COMPOUND_EVENT_ABI: string[];
export declare const MORPHO_EVENT_ABI: string[];
export declare const CHAINS: ChainConfig[];
export declare const GENERIC_EVENT_NAMES: string[];
export declare const EVENT_NAME_MAP: Record<string, Record<string, string>>;
export declare const CHUNK_SIZE: number;
export declare const POINTS_BY_EVENT: Record<string, number>;
export declare const POOL_EVENT_ABI: string[];
export declare const CHAIN_EVENT_ABIS: Record<string, string[]>;
export declare const EVENT_NAMES: string[];
