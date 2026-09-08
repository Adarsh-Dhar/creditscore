/**
 * Watch stage. Sets up ethers listeners for every configured chain/protocol
 * and, on each new log, calls straight into index.ts's indexLiveLog (decode
 * + validate + DB upsert). This is the code that used to be
 * `startLiveListeners`/`handleLiveLog` inline in index.ts — split out so
 * main.ts can compose watch + index + prove as three independently
 * reasoned-about stages, per the requested "watch / index / prove" process
 * shape, even though watch->index is still a plain function call (a raw log
 * is meaningless until decoded, so there's no value in bussing it).
 *
 * Note on "real time": JsonRpcProvider polls (default ~4s) unless the RPC
 * endpoint is a websocket. For sub-second reaction time, swap in a
 * WebSocketProvider using a wss:// URL from your RPC provider (Alchemy,
 * QuickNode, etc.) — everything else here is unaffected.
 */
import { JsonRpcProvider, Contract, type Log } from "ethers";
import { CHAINS, EVENT_NAME_MAP } from "./config.js";
import { indexLiveLog } from "./index.js";

// Retry configuration for rate limiting
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isRateLimitError(err: any): boolean {
  const message = (err?.message || String(err)).toLowerCase();
  return message.includes("too many requests") || 
         message.includes("-32005") || 
         message.includes("rate limit");
}

function isFilterError(err: any): boolean {
  const message = (err?.message || String(err)).toLowerCase();
  return message.includes("resource not found") || 
         message.includes("-32001") ||
         message.includes("filter") ||
         message.includes("could not coalesce");
}

async function withRetry<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === MAX_RETRIES || !isRateLimitError(err)) {
        throw err;
      }
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[watch] Rate limited on ${context}, retry ${attempt}/${MAX_RETRIES} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Max retries exceeded for ${context}`);
}

export async function startWatchers(): Promise<Contract[]> {
  const contracts: Contract[] = [];

  for (const chainConfig of CHAINS) {
    const { name: chain, rpcEnvVar, protocols } = chainConfig;
    const rpcUrl = process.env[rpcEnvVar];

    if (!rpcUrl) {
      console.log(`[watch] Skipping ${chain}: missing ${rpcEnvVar} in .env`);
      continue;
    }

    console.log(`\n[watch] Setting up listeners for chain: ${chain}`);
    // Configure provider with 60 second polling interval to avoid rate limits
    const provider = new JsonRpcProvider(rpcUrl, undefined, {
      polling: true,
      pollingInterval: 60000, // 60 second polling interval to avoid rate limits
    });
    
    // Add global error handler for provider to suppress filter errors
    provider.on("error", (error) => {
      const message = error?.message || String(error);
      if (isFilterError(error)) {
        // Silently ignore filter errors - ethers.js will recreate filters automatically
        return;
      }
      if (isRateLimitError(error)) {
        // Rate limit errors are expected, log sparingly
        return;
      }
      console.error(`[watch] Provider error on ${chain}: ${message}`);
    });

    for (const protocolConfig of protocols) {
      const { id: protocol, poolAddress: contractAddress, abi, wethGatewayAddress, wethGatewayAbi } =
        protocolConfig;

      if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
        console.log(`[watch] Skipping ${protocol} on ${chain}: pool address not configured`);
        continue;
      }

      console.log(`[watch] Setting up listeners for ${protocol} (${contractAddress})`);

      const poolContract = new Contract(contractAddress, abi, provider);
      contracts.push(poolContract);

      const protocolEventNames = Object.keys(EVENT_NAME_MAP[protocol] || {});
      const poolEventNames = protocolEventNames.filter((name) => !name.includes("ETH"));

      for (const eventName of poolEventNames) {
        poolContract.on(eventName, (...args) => {
          const log = args[args.length - 1] as Log;
          withRetry(
            () => indexLiveLog(log, poolContract, protocol, chain, contractAddress, wethGatewayAddress),
            `${protocol}:${eventName}`
          ).catch((err: any) => {
            const message = err?.message || String(err);
            if (isRateLimitError(err)) {
              console.warn(`[watch] Rate limit hit on ${protocol}:${eventName}, skipping this event`);
            } else if (isFilterError(err)) {
              // Silently ignore filter errors - ethers.js auto-recovers
            } else {
              console.error(`[watch] indexLiveLog error: ${message}`);
            }
          });
        });
        console.log(`[watch]   → Listening for ${eventName} on pool`);
      }

      if (
        protocol === "aave" &&
        wethGatewayAddress &&
        wethGatewayAddress !== "0x0000000000000000000000000000000000000000" &&
        wethGatewayAbi
      ) {
        const gatewayContract = new Contract(wethGatewayAddress, wethGatewayAbi, provider);
        contracts.push(gatewayContract);

        const gatewayEventNames = protocolEventNames.filter((name) => name.includes("ETH"));

        for (const eventName of gatewayEventNames) {
          gatewayContract.on(eventName, (...args) => {
            const log = args[args.length - 1] as Log;
            withRetry(
              () => indexLiveLog(log, gatewayContract, protocol, chain, wethGatewayAddress, contractAddress),
              `${protocol}:gateway:${eventName}`
            ).catch((err: any) => {
              const message = err?.message || String(err);
              if (isRateLimitError(err)) {
                console.warn(`[watch] Rate limit hit on ${protocol}:gateway:${eventName}, skipping this event`);
              } else if (isFilterError(err)) {
                // Silently ignore filter errors - ethers.js auto-recovers
              } else {
                console.error(`[watch] indexLiveLog error: ${message}`);
              }
            });
          });
          console.log(`[watch]   → Listening for ${eventName} on WETHGateway`);
        }
      }
    }
  }

  return contracts;
}

export async function stopWatchers(contracts: Contract[]): Promise<void> {
  await Promise.all(contracts.map((c) => c.removeAllListeners()));
}
