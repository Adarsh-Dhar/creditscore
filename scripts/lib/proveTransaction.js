/**
 * proveTransaction.js
 *
 * The core proof-generation-and-submission mechanism, extracted out of
 * generateAndSubmitProof.js so it can be called once (the original CLI
 * script) or in a loop (scripts/proveQueue.js) without duplicating logic.
 *
 * Does exactly what the original single-tx script did:
 *  1. Finds which block the source Sepolia transaction is in.
 *  2. Confirms the tx actually targeted the Aave V3 Sepolia Pool (off-chain
 *     guard — Attestcoin itself doesn't know what "Aave" is).
 *  3. Waits until Creditcoin has attested that block.
 *  4. Fetches an inclusion proof (Merkle + continuity) for the transaction.
 *  5. Submits that proof to the deployed CreditScoreMVP contract.
 *
 * Unlike the original script, this does NOT read from process.env and does
 * NOT call process.exit — it takes explicit params and returns a result
 * object (or throws), so callers can catch failures per-transaction and
 * keep going.
 *
 * IMPORTANT: same caveat as before — the @gluwa/usc-sdk exact API may have
 * shifted since this was written. If any import or method call below
 * errors, check the current SDK README/docs and adjust accordingly.
 */

const { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes } = require("ethers");
const { chainInfo, proofProvider } = require("@gluwa/usc-sdk");

// ABI without parameter names (Solidity selectors don't include parameter names)
const CONTRACT_ABI = [
  "function proveLoanEvent(address,uint64,uint64,bytes,bytes32,(bytes32,bool)[],bytes32,bytes32[],bytes32,uint8) external",
  "function score(address) external view returns (uint256)",
  "function provenTxHashes(bytes32) external view returns (bool)",
  "function getStats(address) external view returns (uint64,uint64,uint64,uint64,uint64)",
];

// Aave V3 Pool contract on Ethereum Sepolia — confirm this against
// https://github.com/bgd-labs/aave-address-book if Aave redeploys.
const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";

/**
 * @param {object} params
 * @param {string} params.sourceTxHash   Sepolia tx hash to prove.
 * @param {string} params.targetWallet   Wallet address to credit on-chain.
 * @param {number} params.eventType      EventType enum index (see lib/eventTypes.js).
 * @param {string} params.sepoliaRpc
 * @param {string} params.cc3TestnetRpc
 * @param {string} params.proverApiUrl
 * @param {string} params.privateKey
 * @param {string} params.contractAddress
 * @param {(msg: string) => void} [params.log]  Optional log sink (defaults to console.log).
 * @returns {Promise<{alreadyProven: boolean, txHash?: string, scoreBefore: bigint, scoreAfter?: bigint, stats?: object}>}
 */
async function proveTransaction({
  sourceTxHash,
  targetWallet,
  eventType,
  sepoliaRpc,
  cc3TestnetRpc,
  proverApiUrl,
  privateKey,
  contractAddress,
  log = (msg) => console.log(msg),
}) {
  if (eventType === undefined || eventType === null) {
    throw new Error(`No eventType provided for ${sourceTxHash}.`);
  }

  const sourceProvider = new JsonRpcProvider(sepoliaRpc);
  const creditcoinProvider = new JsonRpcProvider(cc3TestnetRpc);

  // --- Step 1: find the chainKey for Sepolia ---
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();

  const sepoliaEntry = supportedChains.find((c) => c.chainId === 11155111); // Ethereum Sepolia chain ID
  if (!sepoliaEntry) {
    throw new Error(
      "No Sepolia entry found in getSupportedChains() — verify current chain support before continuing."
    );
  }
  const chainKey = sepoliaEntry.chainKey;

  // --- Step 2: locate the transaction's block, guard it's an Aave tx ---
  const tx = await sourceProvider.getTransaction(sourceTxHash);
  if (!tx) throw new Error(`Transaction not found on Sepolia: ${sourceTxHash}`);
  const blockNumber = tx.blockNumber;

  if (!tx.to || tx.to.toLowerCase() !== AAVE_V3_SEPOLIA_POOL.toLowerCase()) {
    throw new Error(
      `${sourceTxHash} was not sent to the Aave Pool contract (expected ${AAVE_V3_SEPOLIA_POOL}, got ${tx.to}). Refusing to prove/score a non-Aave transaction.` 
    );
  }

  // --- Step 3: wait for attestation, then generate the real proof ---
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, proverApiUrl);

  log(`  waiting for block ${blockNumber} attestation...`);
  await proofBuilder.waitUntilHeightAttested(chainKey, blockNumber);
  log(`  block ${blockNumber} attested.`);

  const result = await proofBuilder.getProof(sourceTxHash);
  if (!result.success || !result.data) {
    throw new Error(`Proof generation failed for ${sourceTxHash}: ${result.error}`);
  }
  const { headerNumber, txBytes, merkleProof, continuityProof } = result.data;

  // --- Step 4: submit to the contract on Creditcoin ---
  const wallet = new Wallet(privateKey, creditcoinProvider);
  const contract = new Contract(contractAddress, CONTRACT_ABI, wallet);

  const txHashKey = keccak256(toUtf8Bytes(sourceTxHash));

  const alreadyProven = await contract.provenTxHashes(txHashKey).catch(() => false);
  if (alreadyProven) {
    const scoreBefore = await contract.score(targetWallet);
    log(`  already proven on-chain — skipping submission.`);
    return { alreadyProven: true, scoreBefore };
  }

  const scoreBefore = await contract.score(targetWallet);

  const siblingsArray = merkleProof.siblings.map((sibling) => [sibling.hash, sibling.isLeft]);

  const submitTx = await contract.proveLoanEvent(
    targetWallet,
    chainKey,
    headerNumber,
    txBytes,
    merkleProof.root,
    siblingsArray,
    continuityProof.lowerEndpointDigest,
    continuityProof.roots,
    txHashKey,
    eventType
  );
  log(`  tx submitted: ${submitTx.hash}`);
  await submitTx.wait();

  // --- Step 5: read back the result ---
  const scoreAfter = await contract.score(targetWallet);
  const [supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount] =
    await contract.getStats(targetWallet);

  return {
    alreadyProven: false,
    txHash: submitTx.hash,
    scoreBefore,
    scoreAfter,
    stats: { supplyCount, borrowCount, repayCount, withdrawCount, liquidationCount },
  };
}

module.exports = { proveTransaction, AAVE_V3_SEPOLIA_POOL, CONTRACT_ABI };