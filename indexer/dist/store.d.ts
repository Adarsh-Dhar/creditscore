import { type IndexedEvent } from "@prisma/client";
export interface Checkpoint {
    lastIndexedBlock: number | null;
}
export type NewIndexedEvent = Omit<IndexedEvent, "id" | "createdAt">;
export declare function loadCheckpoint(chain: string, contractAddress: string): Promise<Checkpoint>;
export declare function saveCheckpoint(chain: string, contractAddress: string, lastIndexedBlock: number): Promise<void>;
export declare function loadEvents(): Promise<IndexedEvent[]>;
export declare function saveEvent(eventData: NewIndexedEvent): Promise<IndexedEvent>;
export declare function upsertEvent(eventData: NewIndexedEvent): Promise<IndexedEvent>;
export declare function loadUnprovenEvents(limit?: number, chain?: string | null, protocol?: string | null): Promise<IndexedEvent[]>;
export declare function loadEventByTxHash(txHash: string | null | undefined): Promise<IndexedEvent | null>;
export declare function markProven(txHash: string): Promise<void>;
export declare function getSeenKeys(): Promise<Set<string>>;
export declare function disconnect(): Promise<void>;
export declare function awardPoints(wallet: string, eventName: string): Promise<void>;
