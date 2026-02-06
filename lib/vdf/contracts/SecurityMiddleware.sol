// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SecurityMiddleware
 * @notice Main security layer with VDF time-locks and guardian bypass
 * flow:
 * - ML bot flags suspicious transactions
 * - Flagged tx trigger 30 minute VDF timelock
 * - Guardians review in parallel via ZK voting
 * - If 7/10 approve → VDF BYPASSED, execute immediately, else block
 * - If no guardian response → VDF completes naturally
 */

// --- interfaces ---
interface IZKVoteVerifier {
    function getProposalState(bytes32 proposalId) external view returns (
        uint8 commitCount,
        uint8 revealCount,
        uint8 approvals,
        uint8 rejections,
        uint8 abstentions,
        bool finalized
    );
}

interface IVDFVerifier {
    function verify(
        bytes32 txHash,
        uint256 startTime,
        bytes calldata proof
    ) external view returns (bool);
}

interface IFROSTVerifier {
    function verify(
        bytes32 message,
        bytes32 R,
        bytes32 z
    ) external returns (bool);
}
//-----------------------------
contract SecurityMiddleware {
    
    // --- Interfaces ---
    IZKVoteVerifier public zkVoteVerifier;
    IVDFVerifier public vdfVerifier;
    IFROSTVerifier public frostVerifier;
    
    // --- Constants ---
    uint8 public constant GUARDIAN_THRESHOLD = 7;
    uint256 public constant VDF_DELAY = 1800;
    
    // --- State ---
    struct PendingTransaction {
        bytes32 txHash;
        address sender;
        address destination;
        uint256 value;
        bool mlBotFlagged;
        uint256 vdfStartTime;
        uint256 vdfDeadline;
        bytes32 proposalId;
        bool executed;
        bool guardianApproved;
        bool guardianRejected;
        bytes txData;
    }
    
    mapping(bytes32 => PendingTransaction) public pendingTxs;
    mapping(address => bool) public blacklistedAddresses;
    bool public isPaused;
    
    // --- Events ---
    event TransactionQueued(
        bytes32 indexed txHash,
        bytes32 indexed proposalId,
        bool mlBotFlagged,
        uint256 vdfDeadline,
        string reason
    );
    
    event TransactionExecuted(
        bytes32 indexed txHash,
        string executionPath
    );
    
    event TransactionBlocked(
        bytes32 indexed txHash,
        string reason
    );
    
    event GuardianBypass(
        bytes32 indexed txHash,
        bytes32 indexed proposalId,
        uint8 approvals
    );
    
    event MLBotFlagged(
        bytes32 indexed txHash,
        uint256 suspicionScore,
        string reason
    );
    
    // --- Constructor ---
    constructor(
        address _zkVoteVerifier,
        address _vdfVerifier,
        address _frostVerifier
    ) {
        zkVoteVerifier = IZKVoteVerifier(_zkVoteVerifier);
        vdfVerifier = IVDFVerifier(_vdfVerifier);
        frostVerifier = IFROSTVerifier(_frostVerifier);
    }
    
    // --- Main Functions ---
    
    function queueTransaction(
        bytes32 txHash,
        address sender,
        address destination,
        uint256 value,
        bool mlBotFlagged,
        bytes calldata txData
    ) external returns (bytes32 proposalId) {
        require(pendingTxs[txHash].vdfStartTime == 0, "Already queued");
        require(!isPaused, "System paused");
        require(!blacklistedAddresses[sender], "Sender blacklisted");
        require(!blacklistedAddresses[destination], "Destination blacklisted");
        
        // Calculate VDF duration based on ML bot flag
        uint256 vdfDuration = mlBotFlagged ? VDF_DELAY : 0;
        
        // Generate proposal ID
        proposalId = keccak256(abi.encodePacked(txHash, block.timestamp, block.number));
        
        // Store transaction
        pendingTxs[txHash] = PendingTransaction({
            txHash: txHash,
            sender: sender,
            destination: destination,
            value: value,
            mlBotFlagged: mlBotFlagged,
            vdfStartTime: block.timestamp,
            vdfDeadline: block.timestamp + vdfDuration,
            proposalId: proposalId,
            executed: false,
            guardianApproved: false,
            guardianRejected: false,
            txData: txData
        });
        
        string memory reason = mlBotFlagged 
            ? "ML bot flagged as suspicious - VDF started"
            : "Clean transaction - no VDF";
            
        emit TransactionQueued(
            txHash,
            proposalId,
            mlBotFlagged,
            block.timestamp + vdfDuration,
            reason
        );
        
        return proposalId;
    }
    
    /**
     * @notice Execute transaction - THREE PATHS TO SUCCESS
     * 
     * Path A: Not Flagged - INSTANT execution
     * Path B: Flagged -> Guardians Approve - FAST: 2-5 minutes
     * Path C: VDF Complete but guardins failed to act: SLOW - 30 minutes
     */
    function executeTransaction(
        bytes32 txHash,
        bytes calldata vdfProof,
        bytes32 frostR,
        bytes32 frostZ
    ) external {
        PendingTransaction storage ptx = pendingTxs[txHash];
        require(ptx.vdfStartTime > 0, "Transaction not queued");
        require(!ptx.executed, "Already executed");
        require(!isPaused, "System paused");

        // PATH A: Not flagged by ML bot → instant execution
        if (!ptx.mlBotFlagged) {
            ptx.executed = true;
            _executePtx(ptx);
            emit TransactionExecuted(txHash, "CLEAN_TRANSACTION");
            return;
        }

        // CHECK: Has guardian REJECTED?
        if (_isGuardianRejected(ptx.proposalId)) {
            ptx.executed = true;
            ptx.guardianRejected = true;
            emit TransactionBlocked(txHash, "GUARDIAN_REJECTION");
            revert("Transaction rejected by guardians");
        }

        // PATH B: Guardian Approval → BYPASS VDF
        if (_isGuardianApproved(ptx.proposalId)) {
            // Verify FROST signature
            require(
                frostVerifier.verify(ptx.proposalId, frostR, frostZ),
                "Invalid FROST signature"
            );

            ptx.executed = true;
            ptx.guardianApproved = true;

            _executePtx(ptx);

            emit GuardianBypass(txHash, ptx.proposalId, GUARDIAN_THRESHOLD);
            emit TransactionExecuted(txHash, "GUARDIAN_BYPASS");
            return;
        }

        // PATH C: VDF Complete → Verify Time + Proof
        require(block.timestamp >= ptx.vdfDeadline, "VDF not yet complete");

        // Verify VDF proof
        require(
            vdfVerifier.verify(txHash, ptx.vdfStartTime, vdfProof),
            "Invalid VDF proof"
        );

        ptx.executed = true;
        _executePtx(ptx);

        emit TransactionExecuted(txHash, "VDF_COMPLETE");
    }
    
    /**
     * @notice Emergency pause by guardians
     */
    function emergencyPause(
        bytes32 eventId,
        bytes32 frostR,
        bytes32 frostZ
    ) external {
        require(!isPaused, "Already paused");
        
        bytes32 message = keccak256(abi.encodePacked("EMERGENCY_PAUSE", eventId));
        require(
            frostVerifier.verify(message, frostR, frostZ),
            "Invalid FROST signature"
        );
        
        isPaused = true;
    }
    
    /**
     * @notice Unpause system
     */
    function unpause(
        bytes32 eventId,
        bytes32 frostR,
        bytes32 frostZ
    ) external {
        require(isPaused, "Not paused");
        
        bytes32 message = keccak256(abi.encodePacked("UNPAUSE", eventId));
        require(
            frostVerifier.verify(message, frostR, frostZ),
            "Invalid FROST signature"
        );
        
        isPaused = false;
    }
    
    // --- Internal Functions ---
    
    /**
     * @dev Check if guardians approved (7/10 vote APPROVE)
     */
    function _isGuardianApproved(bytes32 proposalId) internal view returns (bool) {
        (,, uint8 approvals,,, bool finalized) = zkVoteVerifier.getProposalState(proposalId);
        return finalized && approvals >= GUARDIAN_THRESHOLD;
    }
    
    /**
     * @dev Check if guardians rejected (7/10 vote REJECT)
     */
    function _isGuardianRejected(bytes32 proposalId) internal view returns (bool) {
        (,, uint8 approvals, uint8 rejections,, bool finalized) = zkVoteVerifier.getProposalState(proposalId);
        return finalized && rejections >= GUARDIAN_THRESHOLD;
    }
    
    /**
     * @dev Execute the actual transaction
     */
    function _executePtx(PendingTransaction memory ptx) internal {
        // Call destination contract with txData
        (bool success,) = ptx.destination.call{value: ptx.value}(ptx.txData);
        require(success, "Transaction execution failed");
    }

    // --- views ---
    function getTransactionStatus(bytes32 txHash) external view returns (
        bool exists,
        bool mlBotFlagged,
        bool executed,
        bool guardianApproved,
        bool guardianRejected,
        uint256 vdfDeadline,
        bool vdfComplete
    ) {
        PendingTransaction memory ptx = pendingTxs[txHash];
        return (
            ptx.vdfStartTime > 0,
            ptx.mlBotFlagged,
            ptx.executed,
            ptx.guardianApproved,
            ptx.guardianRejected,
            ptx.vdfDeadline,
            block.timestamp >= ptx.vdfDeadline
        );
    }
    function getVDFDelay() external pure returns (uint256) {
        return VDF_DELAY;
    }
}
