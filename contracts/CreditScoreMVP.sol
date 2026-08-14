// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface to Creditcoin's native Attestcoin verifier precompile.
/// @dev Confirm this interface (function name/signature) against the current
///      docs at https://docs.creditcoin.org/usc before deploying — precompile
///      interfaces can change between testnet versions.
interface IAttestcoinVerifier {
    function verify(
        uint256 chainKey,
        uint256 blockHeight,
        bytes calldata encodedTx,
        bytes calldata merkleProof,
        bytes calldata continuityProof
    ) external view returns (bool);
}

/// @title CreditScoreMVP
/// @notice Minimal proof-of-concept: verifies that a specific transaction
///         occurred on a supported source chain (via Attestcoin), and
///         increments a simple on-chain score for the associated wallet.
///         This intentionally does NOT decode Aave-specific calldata —
///         it only proves inclusion, which is enough to demonstrate the
///         core mechanism end-to-end.
contract CreditScoreMVP {
    // Attestcoin native verifier precompile address.
    // Confirm this is still correct for the current CC3 Testnet before deploying.
    address public constant VERIFIER = 0x0000000000000000000000000000000000FD2;

    mapping(address => uint256) public score;
    mapping(bytes32 => bool) public provenTxHashes; // prevents double-scoring the same tx

    event LoanEventProven(address indexed wallet, uint256 chainKey, uint256 blockHeight, bytes32 txHashKey);

    /// @param wallet The wallet to credit the score to (since the precompile
    ///        only proves tx inclusion, not "who it belongs to" in your app's
    ///        terms, you pass this explicitly for the MVP).
    /// @param chainKey Creditcoin-internal source chain identifier (get this
    ///        from PrecompileChainInfoProvider.getSupportedChains() off-chain).
    /// @param blockHeight The source chain block the transaction is in.
    /// @param encodedTx The raw encoded transaction bytes being proven.
    /// @param merkleProof Merkle inclusion proof for the transaction.
    /// @param continuityProof Continuity proof linking the block to attested chain state.
    /// @param txHashKey A unique key (e.g. keccak256 of the source tx hash) used
    ///        to prevent proving/scoring the same transaction twice.
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

        bool ok = IAttestcoinVerifier(VERIFIER).verify(
            chainKey,
            blockHeight,
            encodedTx,
            merkleProof,
            continuityProof
        );
        require(ok, "verification failed");

        provenTxHashes[txHashKey] = true;
        score[wallet] += 10;

        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey);
    }
}
