// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "@gluwa/usc-contracts/contracts/write-ability/INativeQueryVerifier.sol";

/// @title CreditScoreMVP
/// @notice Proof-of-concept: tracks transaction proofs and scores with Attestcoin verification
contract CreditScoreMVP {
    INativeQueryVerifier public immutable VERIFIER;

    mapping(address => uint256) public score;
    mapping(bytes32 => bool) public provenTxHashes;

    event LoanEventProven(address indexed wallet, uint256 chainKey, uint256 blockHeight, bytes32 txHashKey);

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
        bytes32 txHashKey
    ) external {
        require(!provenTxHashes[txHashKey], "already proven");

        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        bool verified = VERIFIER.verify(chainKey, blockHeight, encodedTx, merkleProof, continuityProof);
        require(verified, "verification failed");

        provenTxHashes[txHashKey] = true;
        score[wallet] += 10;

        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey);
    }
}
