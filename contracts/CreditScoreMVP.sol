// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "@gluwa/usc-contracts/contracts/write-ability/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol";

/// @title INativeQueryVerifierBatch
/// @notice Full interface for batch verification, including the batch verify overload
/// The usc-contracts package only includes the lean single-tx interface,
/// so we extend it here to support batch verification.
interface INativeQueryVerifierBatch {
    /// @notice Verify a batch of transactions with a shared continuity proof
    /// @param chainKey Chain identifier
    /// @param heights Array of block heights for each transaction
    /// @param encodedTxs Array of encoded transaction bytes
    /// @param merkleProofs Array of Merkle proofs for each transaction
    /// @param sharedContinuityProof Single continuity proof shared across all transactions
    /// @return bool True if all transactions are verified
    function verify(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTxs,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external view returns (bool);
}

/// @title CreditScoreMVP
/// @notice Proof-of-concept: tracks per-action-type verified event counts per
/// wallet, and computes a weighted score as a view over that state.
/// Wallet address is still supplied off-chain (Attestcoin doesn't infer who
/// should be credited). Event type is decoded on-chain from the verified
/// transaction's own calldata via EvmV1Decoder — not trusted from the
/// caller — so a proven event is trustless both in "it happened" and in
/// "this is what it was."
contract CreditScoreMVP {
    INativeQueryVerifier public immutable VERIFIER;

    /// @notice Aave V3 Pool on Ethereum Sepolia. Only transactions sent to
    /// this address are ever credited — decoded from the verified tx itself,
    /// not trusted from the caller. Update if Aave redeploys.
    address public constant AAVE_V3_SEPOLIA_POOL = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;

    // Must match the indexer's EVENT_NAMES order exactly:
    // ["Supply", "Borrow", "Repay", "Withdraw", "LiquidationCall"]
    enum EventType {
        Supply,      // 0
        Borrow,      // 1
        Repay,       // 2
        Withdraw,    // 3
        LiquidationCall // 4
    }

    struct WalletStats {
        uint64 supplyCount;
        uint64 borrowCount;
        uint64 repayCount;
        uint64 withdrawCount;
        uint64 liquidationCount;
    }

    // Named weights — public so they're readable on-chain, not just implied
    // by the formula in a doc somewhere.
    int256 public constant SUPPLY_WEIGHT = 5;
    int256 public constant BORROW_WEIGHT = 2;
    int256 public constant REPAY_WEIGHT = 15;
    int256 public constant WITHDRAW_WEIGHT = 0; // tracked, not yet scored
    int256 public constant LIQUIDATION_WEIGHT = -20;

    mapping(address => WalletStats) public stats;
    mapping(bytes32 => bool) public provenTxHashes;

    // Aave V3 Pool function selectors — keccak256(signature)[:4]. These are
    // the only actions this contract will ever credit; anything else reverts.
    bytes4 constant SEL_SUPPLY = 0x617ba037;                // supply(address,uint256,address,uint16)
    bytes4 constant SEL_BORROW = 0xa415bcad;                 // borrow(address,uint256,uint256,uint16,address)
    bytes4 constant SEL_REPAY = 0x573ade81;                 // repay(address,uint256,uint256,address)
    bytes4 constant SEL_WITHDRAW = 0x69328dec;              // withdraw(address,uint256,address)
    bytes4 constant SEL_LIQUIDATION_CALL = 0x00a718a9;      // liquidationCall(address,address,address,uint256,bool)
    bytes4 constant SEL_SUPPLY_WITH_PERMIT = 0xf5660694;    // supplyWithPermit(address,uint256,uint16,uint256,uint8,bytes32,bytes32)
    bytes4 constant SEL_REPAY_WITH_PERMIT = 0x5cfc1b2c;     // repayWithPermit(address,uint256,uint256,uint16,uint256,uint8,bytes32,bytes32)
    bytes4 constant SEL_REPAY_WITH_ATOKENS = 0x8d7e78b6;    // repayWithATokens(address,uint256,uint256,uint16,address)

    event LoanEventProven(
        address indexed wallet,
        uint256 chainKey,
        uint256 blockHeight,
        bytes32 txHashKey,
        EventType eventType
    );

    constructor() {
        VERIFIER = NativeQueryVerifierLib.getVerifier(); // resolves to the 0x0FD2 precompile
    }

    /// @notice Derives the EventType from the verified transaction's own
    /// calldata — never from a caller-supplied parameter. Also enforces that
    /// the transaction actually targeted the Aave Pool. This is what makes
    /// the credited event type as trustless as the "it happened" fact is.
    function _decodeEventType(bytes memory encodedTx) internal pure returns (EventType) {
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(encodedTx);

        require(!common.toIsNull, "tx has no recipient");
        require(common.to == AAVE_V3_SEPOLIA_POOL, "not an Aave Pool transaction");
        require(common.data.length >= 4, "calldata too short to contain a selector");

        bytes4 selector;
        bytes memory data = common.data;
        assembly {
            selector := mload(add(data, 32))
        }

        if (selector == SEL_SUPPLY) return EventType.Supply;
        if (selector == SEL_BORROW) return EventType.Borrow;
        if (selector == SEL_REPAY) return EventType.Repay;
        if (selector == SEL_WITHDRAW) return EventType.Withdraw;
        if (selector == SEL_LIQUIDATION_CALL) return EventType.LiquidationCall;
        if (selector == SEL_SUPPLY_WITH_PERMIT) return EventType.Supply;
        if (selector == SEL_REPAY_WITH_PERMIT) return EventType.Repay;
        if (selector == SEL_REPAY_WITH_ATOKENS) return EventType.Repay;
        revert("unrecognized Aave Pool selector");
    }

    function proveLoanEvent(
        address wallet,
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTx,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots,
        bytes32 txHashKey,
        EventType claimedEventType
    ) external {
        require(!provenTxHashes[txHashKey], "already proven");

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        bool verified = VERIFIER.verify(chainKey, blockHeight, encodedTx, merkleProof, continuityProof);
        require(verified, "verification failed");

        // Trustless: derived from the verified tx's own calldata, not from
        // the caller's claim. The claimed value must match — a mismatch
        // means the indexer/off-chain script is wrong, not that we should
        // silently trust it.
        EventType actualEventType = _decodeEventType(encodedTx);
        require(actualEventType == claimedEventType, "claimed eventType does not match decoded tx");

        provenTxHashes[txHashKey] = true;
        _creditWallet(wallet, actualEventType);
        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey, actualEventType);
    }

    /// @notice Batch version of proveLoanEvent - proves multiple events in a single transaction
    /// @dev All events in the batch must be from the same chain (same chainKey)
    /// @param wallets Array of wallet addresses to credit
    /// @param eventTypes Array of event types for each wallet
    /// @param txHashKeys Array of keccak256(txHash) for deduplication
    /// @param chainKey Chain identifier (must be the same for all events)
    /// @param heights Array of block heights for each transaction
    /// @param encodedTxs Array of encoded transaction bytes
    /// @param merkleProofs Array of Merkle proofs for each transaction
    /// @param sharedContinuityProof Single continuity proof shared across all transactions
    function proveLoanEventsBatch(
        address[] calldata wallets,
        EventType[] calldata eventTypes,
        bytes32[] calldata txHashKeys,
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTxs,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata sharedContinuityProof
    ) external {
        require(
            wallets.length == eventTypes.length &&
            wallets.length == txHashKeys.length &&
            wallets.length == heights.length &&
            wallets.length == encodedTxs.length &&
            wallets.length == merkleProofs.length,
            "Array length mismatch"
        );
        require(wallets.length > 0, "Empty batch");
        require(wallets.length <= 10, "Batch too large - max 10 events");

        // Check for already-proven transactions (cannot bypass deduplication)
        for (uint i = 0; i < txHashKeys.length; i++) {
            require(!provenTxHashes[txHashKeys[i]], "Transaction already proven");
        }

        // Verify the entire batch with a single continuity proof
        INativeQueryVerifierBatch batchVerifier = INativeQueryVerifierBatch(address(VERIFIER));
        bool verified = batchVerifier.verify(
            chainKey,
            heights,
            encodedTxs,
            merkleProofs,
            sharedContinuityProof
        );
        require(verified, "Batch verification failed");

        // Credit each wallet individually after successful batch verification.
        // eventType is derived per-tx from the verified calldata, exactly as
        // in the single-event path — batching doesn't relax the trust model.
        // Delegated to a helper (rather than inlined) to keep this function's
        // stack frame small under viaIR — inlining the decode call here
        // overflows the Yul stack given how many parameters/locals this
        // function already carries.
        for (uint i = 0; i < wallets.length; i++) {
            _creditBatchEvent(wallets[i], eventTypes[i], txHashKeys[i], chainKey, heights[i], encodedTxs[i]);
        }
    }

    /// @notice Per-item work for a single batch entry: decode, check claim,
    /// mark proven, credit, emit. Split out of proveLoanEventsBatch's loop
    /// purely to keep that function's stack frame under the Yul limit.
    function _creditBatchEvent(
        address wallet,
        EventType claimedEventType,
        bytes32 txHashKey,
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTx
    ) internal {
        EventType actualEventType = _decodeEventType(encodedTx);
        require(actualEventType == claimedEventType, "claimed eventType does not match decoded tx");

        provenTxHashes[txHashKey] = true;
        _creditWallet(wallet, actualEventType);
        emit LoanEventProven(wallet, chainKey, height, txHashKey, actualEventType);
    }

    /// @notice Internal helper to credit a wallet based on event type
    /// @dev Extracted from proveLoanEvent to avoid code duplication
    function _creditWallet(address wallet, EventType eventType) internal {
        WalletStats storage s = stats[wallet];
        if (eventType == EventType.Supply) {
            s.supplyCount += 1;
        } else if (eventType == EventType.Borrow) {
            s.borrowCount += 1;
        } else if (eventType == EventType.Repay) {
            s.repayCount += 1;
        } else if (eventType == EventType.Withdraw) {
            s.withdrawCount += 1;
        } else if (eventType == EventType.LiquidationCall) {
            s.liquidationCount += 1;
        }
    }

    /// @notice Weighted score, floored at 0. Same external signature as
    /// before (`score(address) view returns (uint256)`) — off-chain scripts
    /// that only ever called this getter don't need ABI changes.
    function score(address wallet) external view returns (uint256) {
        WalletStats memory s = stats[wallet];

        int256 raw = int256(uint256(s.supplyCount)) * SUPPLY_WEIGHT
            + int256(uint256(s.borrowCount)) * BORROW_WEIGHT
            + int256(uint256(s.repayCount)) * REPAY_WEIGHT
            + int256(uint256(s.withdrawCount)) * WITHDRAW_WEIGHT
            + int256(uint256(s.liquidationCount)) * LIQUIDATION_WEIGHT;

        return raw > 0 ? uint256(raw) : 0;
    }

    /// @notice Raw per-type counts, for verification/debugging — lets you
    /// confirm the exact inputs behind a given score.
    function getStats(address wallet)
        external
        view
        returns (uint64 supplyCount, uint64 borrowCount, uint64 repayCount, uint64 withdrawCount, uint64 liquidationCount)
    {
        WalletStats memory s = stats[wallet];
        return (s.supplyCount, s.borrowCount, s.repayCount, s.withdrawCount, s.liquidationCount);
    }
}