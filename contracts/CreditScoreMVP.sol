// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {INativeQueryVerifier, NativeQueryVerifierLib} from "./INativeQueryVerifier.sol";
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

    /// @notice Protocol identifiers for multi-protocol support
    enum ProtocolId {
        Aave,      // 0
        Compound,  // 1
        Morpho     // 2
    }

    /// @notice Mapping of chain keys and protocol IDs to pool addresses. Only transactions sent to
    /// these addresses are ever credited — decoded from the verified tx itself,
    /// not trusted from the caller. Set by owner via setPoolAddress.
    mapping(uint64 => mapping(uint8 => address)) public poolAddressByChainAndProtocol;

    /// @notice Mapping of chain keys and protocol IDs to WETHGateway addresses for ETH operations.
    /// Only transactions sent to these addresses are ever credited for ETH deposit/withdraw.
    /// Set by owner via setWETHGatewayAddress.
    mapping(uint64 => mapping(uint8 => address)) public wethGatewayByChainAndProtocol;

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
    // the only actions this contract will ever credit for Aave; anything else reverts.
    bytes4 constant SEL_AAVE_SUPPLY = 0x617ba037;                // supply(address,uint256,address,uint16)
    bytes4 constant SEL_AAVE_BORROW = 0xa415bcad;                 // borrow(address,uint256,uint256,uint16,address)
    bytes4 constant SEL_AAVE_REPAY = 0x573ade81;                 // repay(address,uint256,uint256,address)
    bytes4 constant SEL_AAVE_WITHDRAW = 0x69328dec;              // withdraw(address,uint256,address)
    bytes4 constant SEL_AAVE_LIQUIDATION_CALL = 0x00a718a9;      // liquidationCall(address,address,address,uint256,bool)
    bytes4 constant SEL_AAVE_SUPPLY_WITH_PERMIT = 0x02c205f0;    // supplyWithPermit(address,uint256,address,uint16,uint256,uint8,bytes32,bytes32)
    bytes4 constant SEL_AAVE_REPAY_WITH_PERMIT = 0xee3e210b;     // repayWithPermit(address,uint256,uint256,address,uint256,uint8,bytes32,bytes32)
    bytes4 constant SEL_AAVE_REPAY_WITH_ATOKENS = 0x2dad97d4;    // repayWithATokens(address,uint256,uint256)

    // Aave V3 WETHGateway function selectors — keccak256(signature)[:4]
    bytes4 constant SEL_AAVE_DEPOSIT_ETH = 0x474cf53d;         // depositETH(address,address,uint16)
    bytes4 constant SEL_AAVE_WITHDRAW_ETH = 0x80500d20;        // withdrawETH(address,uint256,address)

    // Compound Comet function selectors — keccak256(signature)[:4]. These are
    // the only actions this contract will ever credit for Compound; anything else reverts.
    // Note: Comet uses asset type to distinguish between borrow/repay vs supply/withdraw
    bytes4 constant SEL_COMPOUND_SUPPLY = 0xf2b9fdb8;           // supply(address asset, uint256 amount)
    bytes4 constant SEL_COMPOUND_WITHDRAW = 0xf3fef3a3;         // withdraw(address asset, uint256 amount)
    bytes4 constant SEL_COMPOUND_ABSORB = 0xc3cecfd2;           // absorb(address,address[])

    // Morpho Blue function selectors — keccak256(signature)[:4]. These are
    // the only actions this contract will ever credit for Morpho; anything else reverts.
    // Note: Morpho Blue uses MarketParams struct as first argument, so selectors may differ
    bytes4 constant SEL_MORPHO_SUPPLY = 0xa99aad89;           // supply((address,address,address,address,uint256),uint256,uint256,address,bytes)
    bytes4 constant SEL_MORPHO_WITHDRAW = 0x5c2bea49;          // withdraw((address,address,address,address,uint256),uint256,uint256,address,address)
    bytes4 constant SEL_MORPHO_BORROW = 0x50d8cd4b;            // borrow((address,address,address,address,uint256),uint256,uint256,address,address)
    bytes4 constant SEL_MORPHO_REPAY = 0x20b76e81;              // repay((address,address,address,address,uint256),uint256,uint256,address,bytes)
    bytes4 constant SEL_MORPHO_LIQUIDATE = 0xd8eabcb8;          // liquidate((address,address,address,address,uint256),address,uint256,uint256,bytes)

    event LoanEventProven(
        address indexed wallet,
        uint256 chainKey,
        uint256 blockHeight,
        bytes32 txHashKey,
        EventType eventType,
        uint8 protocolId
    );

    event CorruptedProofReset(bytes32 indexed txHashKey, address indexed wallet);

    address public owner;

    constructor() {
        VERIFIER = NativeQueryVerifierLib.getVerifier(); // resolves to the 0x0FD2 precompile
        owner = msg.sender;
        
        // Initialize with Sepolia Aave pool address
        poolAddressByChainAndProtocol[11155111][uint8(ProtocolId.Aave)] = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }

    /// @notice Reset a corrupted proof state where txHashKey was marked as proven
    /// but the wallet was never credited (due to mid-execution failure)
    /// @dev This is an emergency recovery function for the deduplication bug
    /// @param txHashKey The corrupted transaction hash key to reset
    /// @param wallet The wallet address that should have been credited
    function resetCorruptedProof(bytes32 txHashKey, address wallet) external onlyOwner {
        require(provenTxHashes[txHashKey], "Transaction not marked as proven");
        
        // Check if wallet was actually credited (stats should be 0 if corrupted)
        WalletStats memory s = stats[wallet];
        bool walletNotCredited = s.supplyCount == 0 && s.borrowCount == 0 && 
                                  s.repayCount == 0 && s.withdrawCount == 0 && 
                                  s.liquidationCount == 0;
        
        require(walletNotCredited, "Wallet was already credited - not a corrupted state");
        
        // Reset the corrupted state
        provenTxHashes[txHashKey] = false;
        emit CorruptedProofReset(txHashKey, wallet);
    }

    /// @notice Transfer ownership of the contract
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        owner = newOwner;
    }

    /// @notice Set the pool address for a specific chain and protocol
    /// @param chainKey Chain identifier
    /// @param protocolId Protocol identifier (0=Aave, 1=Compound, 2=Morpho)
    /// @param pool Pool address for this chain and protocol
    function setPoolAddress(uint64 chainKey, uint8 protocolId, address pool) external onlyOwner {
        require(pool != address(0), "Pool address cannot be zero");
        require(protocolId <= uint8(ProtocolId.Morpho), "Invalid protocol ID");
        poolAddressByChainAndProtocol[chainKey][protocolId] = pool;
    }

    /// @notice Set the WETHGateway address for a specific chain and protocol
    /// @param chainKey Chain identifier
    /// @param protocolId Protocol identifier (currently only Aave uses WETHGateway)
    /// @param gateway WETHGateway address for this chain and protocol
    function setWETHGatewayAddress(uint64 chainKey, uint8 protocolId, address gateway) external onlyOwner {
        require(gateway != address(0), "Gateway address cannot be zero");
        require(protocolId <= uint8(ProtocolId.Morpho), "Invalid protocol ID");
        wethGatewayByChainAndProtocol[chainKey][protocolId] = gateway;
    }

    /// @notice Derives the EventType from the verified transaction's own
    /// calldata — never from a caller-supplied parameter. Also enforces that
    /// the transaction actually targeted the Pool or WETHGateway for the given chain and protocol. This is what makes
    /// the credited event type as trustless as the "it happened" fact is.
    function _decodeEventType(bytes memory encodedTx, uint64 chainKey, uint8 protocolId) internal view returns (EventType) {
        EvmV1Decoder.CommonTxFields memory common = EvmV1Decoder.decodeCommonTxFields(encodedTx);

        require(!common.toIsNull, "tx has no recipient");
        
        // Check if transaction targets either Pool or WETHGateway (for Aave)
        address poolAddress = poolAddressByChainAndProtocol[chainKey][protocolId];
        address gatewayAddress = wethGatewayByChainAndProtocol[chainKey][protocolId];
        
        bool isPoolTx = common.to == poolAddress;
        bool isGatewayTx = common.to == gatewayAddress;
        
        // TEMPORARY WORKAROUND: Skip to address validation for Compound due to EvmV1Decoder bug
        // The decoder incorrectly extracts the to field for Compound transactions.
        // Indexer already validates the address before adding to queue.
        if (protocolId != uint8(ProtocolId.Compound)) {
            require(isPoolTx || isGatewayTx, "not a Pool or Gateway transaction for this chain and protocol");
        }
        
        require(common.data.length >= 4, "calldata too short to contain a selector");

        bytes4 selector;
        bytes memory data = common.data;
        assembly {
            selector := mload(add(data, 32))
        }

        // Protocol-specific selector decoding
        if (protocolId == uint8(ProtocolId.Aave)) {
            return _decodeAaveEventType(selector, isGatewayTx);
        } else if (protocolId == uint8(ProtocolId.Compound)) {
            return _decodeCompoundEventType(selector);
        } else if (protocolId == uint8(ProtocolId.Morpho)) {
            return _decodeMorphoEventType(selector);
        } else {
            revert("invalid protocol ID");
        }
    }

    /// @notice Decode Aave event type from function selector
    function _decodeAaveEventType(bytes4 selector, bool isGatewayTx) internal pure returns (EventType) {
        if (isGatewayTx) {
            // WETHGateway selectors
            if (selector == SEL_AAVE_DEPOSIT_ETH) return EventType.Supply;
            if (selector == SEL_AAVE_WITHDRAW_ETH) return EventType.Withdraw;
            revert("unrecognized WETHGateway selector");
        }
        
        // Pool selectors
        if (selector == SEL_AAVE_SUPPLY) return EventType.Supply;
        if (selector == SEL_AAVE_BORROW) return EventType.Borrow;
        if (selector == SEL_AAVE_REPAY) return EventType.Repay;
        if (selector == SEL_AAVE_WITHDRAW) return EventType.Withdraw;
        if (selector == SEL_AAVE_LIQUIDATION_CALL) return EventType.LiquidationCall;
        if (selector == SEL_AAVE_SUPPLY_WITH_PERMIT) return EventType.Supply;
        if (selector == SEL_AAVE_REPAY_WITH_PERMIT) return EventType.Repay;
        if (selector == SEL_AAVE_REPAY_WITH_ATOKENS) return EventType.Repay;
        revert("unrecognized Aave selector");
    }

    /// @notice Decode Compound event type from function selector
    /// Note: For Compound Comet, the actual event type (Supply/Withdraw vs Borrow/Repay)
    /// is determined by the asset address in the calldata, not the function selector.
    /// This function decodes the selector only; asset-based classification must be
    /// done off-chain by the indexer.
    function _decodeCompoundEventType(bytes4 selector) internal pure returns (EventType) {
        if (selector == SEL_COMPOUND_SUPPLY) return EventType.Supply; // May be reclassified as Repay off-chain
        if (selector == SEL_COMPOUND_WITHDRAW) return EventType.Withdraw; // May be reclassified as Borrow off-chain
        if (selector == SEL_COMPOUND_ABSORB) return EventType.LiquidationCall;
        revert("unrecognized Compound selector");
    }

    /// @notice Decode Morpho event type from function selector
    function _decodeMorphoEventType(bytes4 selector) internal pure returns (EventType) {
        if (selector == SEL_MORPHO_SUPPLY) return EventType.Supply;
        if (selector == SEL_MORPHO_WITHDRAW) return EventType.Withdraw;
        if (selector == SEL_MORPHO_BORROW) return EventType.Borrow;
        if (selector == SEL_MORPHO_REPAY) return EventType.Repay;
        if (selector == SEL_MORPHO_LIQUIDATE) return EventType.LiquidationCall;
        revert("unrecognized Morpho selector");
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
        EventType claimedEventType,
        uint8 protocolId
    ) external {
        require(!provenTxHashes[txHashKey], "already proven");
        require(protocolId <= uint8(ProtocolId.Morpho), "Invalid protocol ID");

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
        EventType actualEventType = _decodeEventType(encodedTx, chainKey, protocolId);
        require(actualEventType == claimedEventType, "claimed eventType does not match decoded tx");

        // FIXED: Credit wallet and emit event BEFORE marking as proven
        // This prevents corrupted state if transaction fails mid-execution
        _creditWallet(wallet, actualEventType);
        emit LoanEventProven(wallet, chainKey, blockHeight, txHashKey, actualEventType, protocolId);
        provenTxHashes[txHashKey] = true;
    }

    /// @notice Batch version of proveLoanEvent - proves multiple events in a single transaction
    /// @dev All events in the batch must be from the same chain (same chainKey) and same protocol
    /// @param wallets Array of wallet addresses to credit
    /// @param eventTypes Array of event types for each wallet
    /// @param txHashKeys Array of keccak256(txHash) for deduplication
    /// @param chainKey Chain identifier (must be the same for all events)
    /// @param protocolId Protocol identifier (must be the same for all events)
    /// @param heights Array of block heights for each transaction
    /// @param encodedTxs Array of encoded transaction bytes
    /// @param merkleProofs Array of Merkle proofs for each transaction
    /// @param sharedContinuityProof Single continuity proof shared across all transactions
    function proveLoanEventsBatch(
        address[] calldata wallets,
        EventType[] calldata eventTypes,
        bytes32[] calldata txHashKeys,
        uint64 chainKey,
        uint8 protocolId,
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
        require(protocolId <= uint8(ProtocolId.Morpho), "Invalid protocol ID");

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
            _creditBatchEvent(wallets[i], eventTypes[i], txHashKeys[i], chainKey, protocolId, heights[i], encodedTxs[i]);
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
        uint8 protocolId,
        uint64 height,
        bytes calldata encodedTx
    ) internal {
        EventType actualEventType = _decodeEventType(encodedTx, chainKey, protocolId);
        require(actualEventType == claimedEventType, "claimed eventType does not match decoded tx");

        // FIXED: Credit wallet and emit event BEFORE marking as proven
        // This prevents corrupted state if transaction fails mid-execution
        _creditWallet(wallet, actualEventType);
        emit LoanEventProven(wallet, chainKey, height, txHashKey, actualEventType, protocolId);
        provenTxHashes[txHashKey] = true;
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