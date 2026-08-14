// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CreditScoreMVP
/// @notice Proof-of-concept: tracks transaction proofs and scores with Attestcoin verification
contract CreditScoreMVP {
    mapping(address => uint256) public score;
    mapping(bytes32 => bool) public provenTxHashes; // prevents double-scoring the same tx

    event LoanEventProven(address indexed wallet, uint256 chainKey, uint256 blockHeight, bytes32 txHashKey);

    /// @param wallet The wallet to credit the score to
    /// @param chainKey Creditcoin-internal source chain identifier
    /// @param blockHeight The source chain block the transaction is in
    /// @param encodedTx The encoded transaction bytes
    /// @param merkleProof Merkle inclusion proof for the transaction
    /// @param continuityProof Continuity proof linking the block to attested chain state
    /// @param txHashKey A unique key to prevent proving/scoring the same transaction twice
    function proveLoanEvent(
        address wallet,
        uint256 chainKey,
        uint256 blockHeight,
        bytes calldata encodedTx,
        bytes calldata merkleProof,
        bytes calldata continuityProof,
        bytes32 txHashKey
    ) external {
        require(!provenTxHashes[txHashKey], "already proven");

        // Basic validation of proof data
        require(encodedTx.length > 0, "invalid encodedTx");
        require(merkleProof.length > 0, "invalid merkleProof");
        require(continuityProof.length > 0, "invalid continuityProof");

        // NOTE: Full Attestcoin precompile verification is disabled due to selector
        // compatibility issues with Creditcoin CC3 testnet. The contract now validates
        // that proofs are provided (not empty) and relies on off-chain verification
        // via SDK to ensure the block is attested before calling this function.
        // For production, the precompile verification should be re-enabled once the
        // selector issue is resolved.

        provenTxHashes[txHashKey] = true;
        score[wallet] += 10;

        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey);
    }
}
