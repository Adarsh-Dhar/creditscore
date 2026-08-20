/**
 * proveBatch.js
 *
 * Batch proof generation and submission for multiple transactions.
 * Uses the USC SDK's getBatchProof to generate a shared continuity proof
 * for multiple transactions from the same chain, then submits them in a
 * single on-chain transaction via proveLoanEventsBatch.
 *
 * This is the production-level implementation that:
 *  - Groups events by chain (batches cannot cross chains)
 *  - Uses getBatchProof for efficient proof generation
 *  - Submits all events in one on-chain transaction
 *  - Maintains per-tx deduplication checks
 *  - Includes comprehensive error handling and logging
 */

const { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes } = require("ethers");
const { chainInfo, proofProvider } = require("@gluwa/usc-sdk");

// Batch contract ABI - using minimal interface for batch function
const BATCH_CONTRACT_ABI = [
  "function proveLoanEventsBatch(address[],uint8[],bytes32[],uint64,uint8,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[])) external",
  "function proveLoanEvent(address,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[],bytes32,uint8,uint8) external",
  "function score(address) external view returns (uint256)",
  "function provenTxHashes(bytes32) external view returns (bool)",
  "function getStats(address) external view returns (uint64,uint64,uint64,uint64,uint64)",
];

// Pool addresses by chain and protocol for validation
const POOL_BY_CHAIN_AND_PROTOCOL = {
  sepolia: {
    aave: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
    compound: process.env.COMPOUND_SEPOLIA_COMET_USDC || "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e",
    morpho: process.env.MORPHO_BLUE_SEPOLIA_ADDRESS || "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  },
  "cc3-testnet": {
    aave: process.env.CC3_LENDING_POOL_ADDRESS || "0x0000000000000000000000000000000000000000", // Placeholder - requires actual lending protocol deployment
  },
};

// WETHGateway addresses by chain and protocol for validation
const WETHGATEWAY_BY_CHAIN_AND_PROTOCOL = {
  sepolia: {
    aave: process.env.AAVE_SEPOLIA_WETHGATEWAY || "0x387d311e47e80b498169e6fb51d3193167d89F7D",
  },
};

// Protocol ID mappings
const PROTOCOL_IDS = {
  aave: 0,
  compound: 1,
  morpho: 2,
};

// Chain ID mappings for supported chains
const CHAIN_IDS = {
  sepolia: 11155111,
  "cc3-testnet": 102031, // Creditcoin CC3 Testnet chain ID (tCTC)
  // Add future chains here as needed
  // "base-sepolia": 84532,
};

// Error types for better error handling
class BatchProofError extends Error {
  constructor(message, code = 'BATCH_PROOF_ERROR') {
    super(message);
    this.code = code;
    this.name = 'BatchProofError';
  }
}

class ChainResolutionError extends BatchProofError {
  constructor(message) {
    super(message, 'CHAIN_RESOLUTION_ERROR');
    this.name = 'ChainResolutionError';
  }
}

class ProofGenerationError extends BatchProofError {
  constructor(message) {
    super(message, 'PROOF_GENERATION_ERROR');
    this.name = 'ProofGenerationError';
  }
}

class ContractSubmissionError extends BatchProofError {
  constructor(message) {
    super(message, 'CONTRACT_SUBMISSION_ERROR');
    this.name = 'ContractSubmissionError';
  }
}

/**
 * Resolve chainKey from chain name using the Creditcoin precompile
 * @param {string} chainName - Chain name (e.g., "sepolia")
 * @param {JsonRpcProvider} creditcoinProvider - Creditcoin RPC provider
 * @param {function} log - Optional logging function
 * @returns {Promise<number>} chainKey
 * @throws {ChainResolutionError} If chain cannot be resolved
 */
async function resolveChainKey(chainName, creditcoinProvider, log = console.log) {
  try {
    log(`  resolving chainKey for ${chainName}...`);
    const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
    const supportedChains = await chainInfoProvider.getSupportedChains();

    const numericChainId = CHAIN_IDS[chainName];
    if (!numericChainId) {
      throw new ChainResolutionError(`Unknown chain name: ${chainName}`);
    }

    const chainEntry = supportedChains.find((c) => c.chainId === numericChainId);
    if (!chainEntry) {
      throw new ChainResolutionError(
        `No ${chainName} entry found in getSupportedChains() — verify current chain support before continuing.`
      );
    }

    log(`  resolved chainKey: ${chainEntry.chainKey}`);
    return chainEntry.chainKey;
  } catch (error) {
    if (error instanceof ChainResolutionError) {
      throw error;
    }
    throw new ChainResolutionError(`Failed to resolve chainKey for ${chainName}: ${error.message}`);
  }
}

/**
 * Generate batch proof for multiple transactions
 * @param {Array<string>} txHashes - Array of transaction hashes
 * @param {number} chainKey - Chain identifier
 * @param {string} proverApiUrl - Proof generation API URL
 * @param {function} log - Optional logging function
 * @returns {Promise<object>} Batch proof data
 * @throws {ProofGenerationError} If proof generation fails
 */
async function generateBatchProof(txHashes, chainKey, proverApiUrl, log = console.log) {
  try {
    if (txHashes.length === 0) {
      throw new ProofGenerationError("Cannot generate batch proof for empty transaction list");
    }

    if (txHashes.length > 10) {
      throw new ProofGenerationError("Batch size exceeds maximum of 10 transactions");
    }

    const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proverApiUrl);

    log(`  generating batch proof for ${txHashes.length} transaction(s)...`);
    log(`  txHashes: ${txHashes.join(", ")}`);

    const result = await proofBuilder.getBatchProof(txHashes);
    if (!result.success || !result.data) {
      throw new ProofGenerationError(`Batch proof generation failed: ${result.error}`);
    }

    log(`  batch proof generated successfully`);
    log(`  continuity proof: ${result.data.continuityProof.lowerEndpointDigest}`);
    return result.data;
  } catch (error) {
    if (error instanceof ProofGenerationError) {
      throw error;
    }
    throw new ProofGenerationError(`Failed to generate batch proof: ${error.message}`);
  }
}

/**
 * Flatten batch proof data into arrays for contract submission
 * @param {object} proofData - Raw batch proof data from SDK
 * @returns {object} Flattened arrays for contract call
 */
function flattenBatchProofData(proofData) {
  const headers = [];
  const txBytes = [];
  const merkleProofs = [];

  for (const [headerNumber, proofsMap] of proofData.merkleProofs.entries()) {
    for (const [_txIndex, proofEntry] of proofsMap.entries()) {
      headers.push(headerNumber);
      txBytes.push(proofEntry.txBytes);
      merkleProofs.push(proofEntry.merkleProof);
    }
  }

  return { headers, txBytes, merkleProofs };
}

/**
 * Submit batch proof to the contract
 * @param {object} params - Batch submission parameters
 * @returns {Promise<object>} Submission result
 * @throws {ContractSubmissionError} If contract submission fails
 */
async function submitBatchProof({
  events,
  chainKey,
  protocolId,
  proofData,
  cc3TestnetRpc,
  privateKey,
  contractAddress,
  log = console.log,
}) {
  try {
    const creditcoinProvider = new JsonRpcProvider(cc3TestnetRpc);
    const wallet = new Wallet(privateKey, creditcoinProvider);
    const contract = new Contract(contractAddress, BATCH_CONTRACT_ABI, wallet);

    // Flatten proof data for contract submission
    const { headers, txBytes, merkleProofs } = flattenBatchProofData(proofData);

    log(`  preparing contract call with ${events.length} events`);

    // Prepare contract parameters
    const wallets = events.map((e) => e.wallet);
    const eventTypes = events.map((e) => e.eventType);
    const txHashKeys = events.map((e) => keccak256(toUtf8Bytes(e.txHash)));

    // Convert merkle proofs to contract format - array of tuples [root, siblings]
    // Ethers v6 requires unnamed tuple params to be arrays, not objects
    const contractMerkleProofs = merkleProofs.map((proof) => {
      const siblingsArray = proof.siblings.map((sibling) => [sibling.hash, sibling.isLeft]);
      return [proof.root, siblingsArray];
    });

    log(`  merkle proofs count: ${contractMerkleProofs.length}`);
    log(`  first merkle proof root: ${contractMerkleProofs[0][0]}`);
    log(`  first merkle proof siblings: ${contractMerkleProofs[0][1].length}`);

    // Convert continuity proof to contract format - tuple [lowerEndpointDigest, roots]
    // Ethers v6 requires unnamed tuple params to be arrays, not objects
    const contractContinuityProof = [
      proofData.continuityProof.lowerEndpointDigest,
      proofData.continuityProof.roots,
    ];

    log(`  submitting batch proof to contract...`);
    log(`  contract address: ${contractAddress}`);

    const submitTx = await contract.proveLoanEventsBatch(
      wallets,
      eventTypes,
      txHashKeys,
      chainKey,
      protocolId,
      headers,
      txBytes,
      contractMerkleProofs,
      contractContinuityProof
    );

    log(`  batch tx submitted: ${submitTx.hash}`);
    const receipt = await submitTx.wait();
    log(`  batch tx confirmed in block ${receipt.blockNumber}`);
    log(`  gas used: ${receipt.gasUsed.toString()}`);

    return {
      txHash: submitTx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
  } catch (error) {
    if (error instanceof ContractSubmissionError) {
      throw error;
    }
    throw new ContractSubmissionError(`Failed to submit batch proof: ${error.message}`);
  }
}

/**
 * Process a batch of events from the same chain and protocol
 * @param {Array} events - Array of events to process (must be from same chain and protocol)
 * @param {object} config - Configuration object
 * @returns {Promise<object>} Processing result
 */
async function processBatch(events, config) {
  const {
    chain,
    protocol,
    sourceRpc,
    cc3TestnetRpc,
    proverApiUrl,
    privateKey,
    contractAddress,
    log = console.log,
  } = config;

  if (events.length === 0) {
    return { processed: 0, skipped: 0, failed: 0 };
  }

  if (!protocol) {
    throw new BatchProofError(`Protocol not specified for batch processing`);
  }

  log(`\n=== Processing batch of ${events.length} event(s) from ${chain} (${protocol}) ===`);

  try {
    const sourceProvider = new JsonRpcProvider(sourceRpc);
    const creditcoinProvider = new JsonRpcProvider(cc3TestnetRpc);

    // Resolve chainKey
    const chainKey = await resolveChainKey(chain, creditcoinProvider, log);

    // Validate all transactions target the Pool or Gateway for this chain and protocol
    const poolAddress = POOL_BY_CHAIN_AND_PROTOCOL[chain]?.[protocol];
    const gatewayAddress = WETHGATEWAY_BY_CHAIN_AND_PROTOCOL[chain]?.[protocol];
    
    if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
      throw new BatchProofError(`No pool address configured for chain ${chain} and protocol ${protocol}`);
    }

    const protocolId = PROTOCOL_IDS[protocol];
    if (protocolId === undefined) {
      throw new BatchProofError(`Unknown protocol: ${protocol}`);
    }

    log(`  validating ${events.length} transaction(s)...`);
    for (const event of events) {
      try {
        const tx = await sourceProvider.getTransaction(event.txHash);
        if (!tx) {
          throw new BatchProofError(`Transaction not found: ${event.txHash}`);
        }

        // Check if transaction targets the protocol contract
        // For Aave, it can target either Pool or WETHGateway
        // For Compound and Morpho, it targets the pool directly
        const isPoolTx = tx.to && tx.to.toLowerCase() === poolAddress.toLowerCase();
        const isGatewayTx = gatewayAddress && tx.to && tx.to.toLowerCase() === gatewayAddress.toLowerCase();

        // Aave requires either Pool or Gateway, others only need Pool
        let isValidProtocolTx = false;
        if (protocol === 'aave') {
          isValidProtocolTx = isPoolTx || isGatewayTx;
        } else {
          isValidProtocolTx = isPoolTx;
        }

        if (!isValidProtocolTx) {
          if (protocol === 'aave') {
            throw new BatchProofError(
              `${event.txHash} was not sent to the Pool or Gateway contract (expected ${poolAddress} or ${gatewayAddress}, got ${tx.to})`
            );
          } else {
            throw new BatchProofError(
              `${event.txHash} was not sent to the ${protocol} contract (expected ${poolAddress}, got ${tx.to})`
            );
          }
        }
        
        log(`  ✓ ${event.txHash.substring(0, 10)}... valid ${protocol} transaction`);
      } catch (error) {
        log(`  ✗ ${event.txHash.substring(0, 10)}... validation failed: ${error.message}`);
        throw error;
      }
    }

    // Wait for the highest block to be attested
    const maxBlockNumber = Math.max(...events.map((e) => e.blockNumber));
    const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proverApiUrl);
    log(`  waiting for block ${maxBlockNumber} attestation...`);
    await proofBuilder.waitUntilHeightAttested(chainKey, maxBlockNumber);
    log(`  block ${maxBlockNumber} attested`);

    // Generate batch proof
    const txHashes = events.map((e) => e.txHash);
    const proofData = await generateBatchProof(txHashes, chainKey, proverApiUrl, log);

    // Check for already-proven transactions
    const creditcoinProvider2 = new JsonRpcProvider(cc3TestnetRpc);
    const wallet = new Wallet(privateKey, creditcoinProvider2);
    const contract = new Contract(contractAddress, BATCH_CONTRACT_ABI, wallet);

    log(`  checking for already-proven transactions...`);
    const alreadyProvenIndices = [];
    for (let i = 0; i < events.length; i++) {
      const txHashKey = keccak256(toUtf8Bytes(events[i].txHash));
      const isProven = await contract.provenTxHashes(txHashKey).catch(() => false);
      if (isProven) {
        alreadyProvenIndices.push(i);
        log(`  ⏭️ ${events[i].txHash.substring(0, 10)}... already proven`);
      }
    }

    if (alreadyProvenIndices.length > 0) {
      log(`  ${alreadyProvenIndices.length} transaction(s) already proven, skipping batch submission`);
      return {
        processed: 0,
        skipped: alreadyProvenIndices.length,
        failed: 0,
        alreadyProven: true,
      };
    }

    // Submit batch proof
    const result = await submitBatchProof({
      events,
      chainKey,
      protocolId,
      proofData,
      cc3TestnetRpc,
      privateKey,
      contractAddress,
      log,
    });

    return {
      processed: events.length,
      skipped: 0,
      failed: 0,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
    };
  } catch (error) {
    log(`  ✗ batch processing failed: ${error.message}`);
    if (error.code) {
      log(`  error code: ${error.code}`);
    }
    throw error;
  }
}


module.exports = {
  resolveChainKey,
  generateBatchProof,
  flattenBatchProofData,
  submitBatchProof,
  processBatch,
  CHAIN_IDS,
  POOL_BY_CHAIN_AND_PROTOCOL,
  WETHGATEWAY_BY_CHAIN_AND_PROTOCOL,
  PROTOCOL_IDS,
  BatchProofError,
  ChainResolutionError,
  ProofGenerationError,
  ContractSubmissionError,
};

// Backward compatibility: create POOL_BY_CHAIN from POOL_BY_CHAIN_AND_PROTOCOL
const POOL_BY_CHAIN = {};
for (const [chain, protocols] of Object.entries(POOL_BY_CHAIN_AND_PROTOCOL)) {
  POOL_BY_CHAIN[chain] = protocols.aave; // Default to Aave for backward compatibility
}
module.exports.POOL_BY_CHAIN = POOL_BY_CHAIN;
module.exports.POOL_BY_CHAIN = POOL_BY_CHAIN;
