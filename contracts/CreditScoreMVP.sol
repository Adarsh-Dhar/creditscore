// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "@gluwa/usc-contracts/contracts/write-ability/INativeQueryVerifier.sol";

/// @title CreditScoreMVP
/// @notice Proof-of-concept: tracks per-action-type verified event counts per
/// wallet, and computes a weighted score as a view over that state.
/// Event type, wallet, and amount are supplied off-chain — Attestcoin only
/// proves the underlying transaction occurred, it doesn't know what an
/// "Aave Supply" is. Same trust model as before, just richer state.
contract CreditScoreMVP {
    INativeQueryVerifier public immutable VERIFIER;

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
        EventType eventType
    ) external {
        require(!provenTxHashes[txHashKey], "already proven");

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        bool verified = VERIFIER.verify(chainKey, blockHeight, encodedTx, merkleProof, continuityProof);
        require(verified, "verification failed");

        provenTxHashes[txHashKey] = true;

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

        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey, eventType);
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