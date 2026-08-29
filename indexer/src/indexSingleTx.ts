/**
 * Decode one source-chain tx's protocol logs and upsert IndexedEvent rows.
 * Used by `npm run prove` to keep Postgres in sync when a tx was never
 * scanned by the full indexer.
 */

import { JsonRpcProvider, Interface, getAddress, isAddress, type Log } from "ethers";
import { CHAINS, EVENT_NAME_MAP, type ProtocolConfig, type ChainConfig } from "./config";
import {
  extractWallet as extractAaveWallet,
  extractAssetAndAmount as extractAaveAssetAndAmount,
} from "./aaveDecoder";
import {
  extractWallet as extractCompoundWallet,
  extractAssetAndAmount as extractCompoundAssetAndAmount,
  classifyCompoundEvent,
} from "./compoundDecoder";
import {
  extractWallet as extractMorphoWallet,
  extractAssetAndAmount as extractMorphoAssetAndAmount,
} from "./morphoDecoder";
import { upsertEvent, type NewIndexedEvent } from "./store";

function checksum(addr: string | null | undefined): string | null | undefined {
  if (!addr || !isAddress(addr)) return addr;
  return getAddress(addr);
}

function resolveProtocolConfig(
  chain: string,
  protocol: string
): { chainConfig: ChainConfig; protocolConfig: ProtocolConfig } {
  const chainConfig = CHAINS.find((c) => c.name === chain);
  if (!chainConfig) {
    throw new Error(`Unknown chain: ${chain}`);
  }
  const protocolConfig = chainConfig.protocols.find((p) => p.id === protocol);
  if (!protocolConfig) {
    throw new Error(`Protocol ${protocol} is not configured for chain ${chain}`);
  }
  return { chainConfig, protocolConfig };
}

interface DecodedFields {
  eventName: string;
  wallet: string | null | undefined;
  asset: string | null | undefined;
  amount: string | null;
}

function decodeLog(
  log: Log,
  protocol: string,
  protocolConfig: ProtocolConfig,
  chain: string
): DecodedFields | null {
  const poolIface = new Interface(protocolConfig.abi);
  const gatewayIface =
    protocol === "aave" && protocolConfig.wethGatewayAbi
      ? new Interface(protocolConfig.wethGatewayAbi)
      : null;

  let parsed;
  try {
    parsed = poolIface.parseLog(log);
  } catch {
    parsed = null;
  }
  if (!parsed && gatewayIface) {
    try {
      parsed = gatewayIface.parseLog(log);
    } catch {
      parsed = null;
    }
  }
  if (!parsed) return null;

  let eventName = parsed.name;
  let wallet: string | null | undefined;
  let asset: string | null | undefined;
  let amount: string | null;

  if (protocol === "aave") {
    wallet = extractAaveWallet(eventName, parsed.args);
    ({ asset, amount } = extractAaveAssetAndAmount(eventName, parsed.args));
  } else if (protocol === "compound") {
    wallet = extractCompoundWallet(eventName, parsed.args);
    ({ asset, amount } = extractCompoundAssetAndAmount(eventName, parsed.args, chain));
    eventName = classifyCompoundEvent(eventName, asset ?? null, chain);
  } else if (protocol === "morpho") {
    wallet = extractMorphoWallet(eventName, parsed.args);
    ({ asset, amount } = extractMorphoAssetAndAmount(eventName, parsed.args));
  } else {
    return null;
  }

  const genericEventName = EVENT_NAME_MAP[protocol]?.[eventName] || eventName;
  return {
    eventName: genericEventName,
    wallet: checksum(wallet),
    asset: asset && isAddress(asset) ? checksum(asset) : asset,
    amount: amount != null ? String(amount) : null,
  };
}

export interface IndexSingleTxParams {
  txHash: string;
  chain: string;
  protocol: string;
  sourceRpc: string;
  expectedWallet?: string;
  eventName?: string;
  proven?: boolean;
}

export async function indexSingleTx({
  txHash,
  chain,
  protocol,
  sourceRpc,
  expectedWallet,
  eventName,
  proven = true,
}: IndexSingleTxParams) {
  const { protocolConfig } = resolveProtocolConfig(chain, protocol);
  const poolAddress = protocolConfig.poolAddress;
  const gatewayAddress = protocolConfig.wethGatewayAddress;

  if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`No pool address configured for ${protocol} on ${chain}`);
  }

  const validTargets = [poolAddress, gatewayAddress]
    .filter((a): a is string => !!a && a !== "0x0000000000000000000000000000000000000000")
    .map((a) => a.toLowerCase());

  const provider = new JsonRpcProvider(sourceRpc);
  const tx = await provider.getTransaction(txHash);
  if (!tx) {
    throw new Error(`Transaction not found on ${chain}: ${txHash}`);
  }
  if (!tx.to || !validTargets.includes(tx.to.toLowerCase())) {
    console.warn(
      `  ! ${txHash} was not sent to ${protocol} on ${chain} (to=${tx.to}); skipping DB backfill.`
    );
    return null;
  }

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Receipt not found on ${chain}: ${txHash}`);
  }

  const block = await provider.getBlock(receipt.blockNumber);
  const timestamp = block?.timestamp ?? null;
  const expected = expectedWallet ? checksum(expectedWallet) : null;

  const decoded: NewIndexedEvent[] = [];
  for (const log of receipt.logs) {
    if (!validTargets.includes(log.address.toLowerCase())) continue;
    const fields = decodeLog(log, protocol, protocolConfig, chain);
    if (!fields || !fields.wallet) continue;
    decoded.push({
      txHash: receipt.hash,
      logIndex: log.index,
      blockNumber: receipt.blockNumber,
      eventName: fields.eventName,
      wallet: fields.wallet,
      asset: fields.asset ?? null,
      amount: fields.amount ?? "0",
      chain,
      protocol,
      timestamp,
      proven,
    });
  }

  let candidates = decoded;
  if (expected) {
    candidates = decoded.filter((e) => e.wallet.toLowerCase() === expected.toLowerCase());
    if (candidates.length === 0) {
      console.warn(
        `  ! no ${protocol} log in ${txHash} matched TARGET_WALLET ${expected}; not writing a mismatched IndexedEvent.`
      );
      return null;
    }
  }

  if (eventName) {
    const named = candidates.filter((e) => e.eventName === eventName);
    if (named.length > 0) candidates = named;
  }

  if (candidates.length === 0) {
    return null;
  }

  let last = null;
  for (const row of candidates) {
    last = await upsertEvent(row);
  }
  return last;
}
