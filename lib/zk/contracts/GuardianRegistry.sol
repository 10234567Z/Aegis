// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title GuardianRegistry
 * @notice Main security state manager for Guardian Protocol.
 *
 * Responsibilities:
 *   1. Manages security state (paused, active, monitoring)
 *   2. Creates voting proposals when ML bot flags attacks
 *   3. Listens for ZKVoteVerifier.ProposalFinalized events
 *   4. Emits FROSTSigningRequired event when vote passes
 *   5. Executes security actions after FROST signature verified
 *   6. Receives cross-chain security messages via LayerZero
 *
 * Integration Flow:
 *   ML bot detects attack → guardian-node calls initiateVote()
 *   → createProposal() in ZKVoteVerifier
 *   → Guardians vote via ZK proofs
 *   → ZKVoteVerifier emits ProposalFinalized
 *   → executeProposal() called with FROST signature
 *   → Security action executed (pause, blacklist, etc.)
 */

interface IZKVoteVerifier {
    function createProposal(bytes32 proposalId, string calldata description) external;
    function getProposalState(bytes32 proposalId) external view returns (
        uint8 commitCount,
        uint8 revealCount,
        uint8 approvals,
        uint8 rejections,
        uint8 abstentions,
        bool finalized
    );
}

interface IFROSTVerifier {
    function verify(bytes32 message, bytes calldata signature) external view returns (bool);
}

contract GuardianRegistry {

    // ─── Events ───
    event ProposalInitiated(bytes32 indexed proposalId, SecurityAction action, string description);
    event FROSTSigningRequired(bytes32 indexed proposalId, SecurityAction action);
    event SecurityActionExecuted(bytes32 indexed proposalId, SecurityAction action, bool success);
    event Paused(bytes32 indexed eventId, string reason);
    event Unpaused(bytes32 indexed eventId);
    event AddressBlacklisted(address indexed target, bytes32 indexed eventId);
    event AddressUnblacklisted(address indexed target, bytes32 indexed eventId);
    event ThresholdIncreased(uint8 oldThreshold, uint8 newThreshold, bytes32 indexed eventId);
    event CrossChainEventReceived(bytes32 indexed eventId, uint16 sourceChain, SecurityAction action);
    event CrossChainMessengerUpdated(address indexed oldMessenger, address indexed newMessenger);

    // ─── Enums ───
    enum SecurityAction {
        EMERGENCY_PAUSE,
        BLACKLIST_ADDRESS,
        THRESHOLD_INCREASE,
        MONITOR_ONLY,
        UNPAUSE
    }

    // ─── State ───
    IZKVoteVerifier public zkVoteVerifier;
    IFROSTVerifier public frostVerifier;
    address public crossChainMessenger;                // CrossChainMessenger contract
    address public owner;                              // For admin functions

    bool public isPaused;
    uint8 public currentThreshold;                     // starts at 7, can increase to 8, 9
    mapping(address => bool) public blacklistedAddresses;
    mapping(bytes32 => bool) public processedProposals; // prevent duplicate execution
    mapping(bytes32 => bool) public processedCrossChainEvents; // prevent cross-chain replay

    // Proposal details
    struct ProposalData {
        SecurityAction action;
        address targetAddress;                         // for BLACKLIST_ADDRESS
        string description;
        bool executed;
    }
    mapping(bytes32 => ProposalData) public proposals;

    // ─── Modifiers ───
    modifier whenNotPaused() {
        require(!isPaused, "Contract is paused");
        _;
    }

    modifier whenPaused() {
        require(isPaused, "Contract is not paused");
        _;
    }

    modifier onlyCrossChainMessenger() {
        require(msg.sender == crossChainMessenger, "Only CrossChainMessenger");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // ─── Constructor ───
    constructor(
        address _zkVoteVerifier,
        address _frostVerifier,
        uint8 _initialThreshold
    ) {
        zkVoteVerifier = IZKVoteVerifier(_zkVoteVerifier);
        frostVerifier = IFROSTVerifier(_frostVerifier);
        currentThreshold = _initialThreshold;
        owner = msg.sender;
    }

    // ─── Admin Functions ───
    /**
     * @notice Sets the CrossChainMessenger contract address.
     * @dev Only callable by owner. Should be set after deployment.
     */
    function setCrossChainMessenger(address _messenger) external onlyOwner {
        require(_messenger != address(0), "Invalid messenger address");
        address oldMessenger = crossChainMessenger;
        crossChainMessenger = _messenger;
        emit CrossChainMessengerUpdated(oldMessenger, _messenger);
    }

    // ─── Proposal Initiation (called by guardian-node when ML bot flags attack) ───
    /**
     * @notice Initiates a new voting proposal.
     * @dev Called by guardian-node off-chain after ML detection or manual guardian decision.
     *      Anyone can call this (permissionless) but requires guardian vote to execute.
     * @param proposalId Unique identifier (typically hash of attack details).
     * @param action The security action to vote on.
     * @param targetAddress Address to blacklist (if action is BLACKLIST_ADDRESS).
     * @param description Human-readable description for guardians.
     */
    function initiateVote(
        bytes32 proposalId,
        SecurityAction action,
        address targetAddress,
        string calldata description
    ) external {
        require(!proposals[proposalId].executed, "Proposal already exists");

        // Store proposal details
        proposals[proposalId] = ProposalData({
            action: action,
            targetAddress: targetAddress,
            description: description,
            executed: false
        });

        // Create ZK voting proposal
        zkVoteVerifier.createProposal(proposalId, description);

        emit ProposalInitiated(proposalId, action, description);
    }

    // ─── Proposal Execution (after ZK vote finalized + FROST signature) ───
    /**
     * @notice Executes a proposal after guardian approval.
     * @dev Called by any guardian after ZK vote finalizes and FROST signature is created.
     * @param proposalId The proposal to execute.
     * @param frostSignature Aggregated FROST signature from 7+ guardians.
     */
    function executeProposal(
        bytes32 proposalId,
        bytes calldata frostSignature
    ) external {
        ProposalData storage p = proposals[proposalId];
        require(!p.executed, "Proposal already executed");
        require(!processedProposals[proposalId], "Proposal already processed");

        // ─── Verify ZK vote passed ───
        (,, uint8 approvals,,, bool finalized) = zkVoteVerifier.getProposalState(proposalId);
        require(finalized, "Proposal not finalized");
        require(approvals >= currentThreshold, "Threshold not reached");

        // ─── Verify FROST signature ───
        require(
            frostVerifier.verify(proposalId, frostSignature),
            "Invalid FROST signature"
        );

        // ─── Mark as processed ───
        p.executed = true;
        processedProposals[proposalId] = true;

        // ─── Execute action ───
        bool success = _executeAction(proposalId, p.action, p.targetAddress);

        emit SecurityActionExecuted(proposalId, p.action, success);
    }

    // ─── Internal Action Execution ───
    function _executeAction(
        bytes32 proposalId,
        SecurityAction action,
        address targetAddress
    ) internal returns (bool) {
        if (action == SecurityAction.EMERGENCY_PAUSE) {
            require(!isPaused, "Already paused");
            isPaused = true;
            emit Paused(proposalId, proposals[proposalId].description);
            return true;

        } else if (action == SecurityAction.UNPAUSE) {
            require(isPaused, "Not paused");
            isPaused = false;
            emit Unpaused(proposalId);
            return true;

        } else if (action == SecurityAction.BLACKLIST_ADDRESS) {
            require(targetAddress != address(0), "Invalid address");
            require(!blacklistedAddresses[targetAddress], "Already blacklisted");
            blacklistedAddresses[targetAddress] = true;
            emit AddressBlacklisted(targetAddress, proposalId);
            return true;

        } else if (action == SecurityAction.THRESHOLD_INCREASE) {
            require(currentThreshold < 10, "Already at max threshold");
            uint8 oldThreshold = currentThreshold;
            currentThreshold++;
            emit ThresholdIncreased(oldThreshold, currentThreshold, proposalId);
            return true;

        } else if (action == SecurityAction.MONITOR_ONLY) {
            // No on-chain action — guardian-nodes increase monitoring sensitivity off-chain
            return true;

        } else {
            return false;
        }
    }

    // ─── Emergency Functions (for use when threshold increased to 9 or 10) ───
    /**
     * @notice Emergency pause bypass — requires threshold signature without ZK vote.
     * @dev Used when immediate action needed and no time for ZK voting ceremony.
     */
    function emergencyPause(
        bytes32 eventId,
        bytes calldata frostSignature
    ) external {
        require(!isPaused, "Already paused");
        require(
            frostVerifier.verify(keccak256(abi.encodePacked("EMERGENCY_PAUSE", eventId)), frostSignature),
            "Invalid FROST signature"
        );

        isPaused = true;
        emit Paused(eventId, "Emergency pause");
    }

    // ─── Views ───
    function isBlacklisted(address addr) external view returns (bool) {
        return blacklistedAddresses[addr];
    }

    function getProposalDetails(bytes32 proposalId) external view returns (
        SecurityAction action,
        address targetAddress,
        string memory description,
        bool executed
    ) {
        ProposalData storage p = proposals[proposalId];
        return (p.action, p.targetAddress, p.description, p.executed);
    }

    function getSecurityState() external view returns (
        bool paused,
        uint8 threshold,
        uint256 proposalCount
    ) {
        // proposalCount would need a counter if we want to track it
        // For now, return 0 as placeholder
        return (isPaused, currentThreshold, 0);
    }

    // ─── Cross-Chain Receiver Functions ───
    // These are called by CrossChainMessenger after receiving LayerZero messages
    // and verifying FROST signatures.

    /**
     * @notice Receives an emergency pause from another chain.
     * @dev Called by CrossChainMessenger after FROST signature verification.
     */
    function receiveRemotePause(
        bytes32 eventId,
        uint16 sourceChain,
        string calldata reason
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        processedCrossChainEvents[eventId] = true;

        if (!isPaused) {
            isPaused = true;
            emit Paused(eventId, reason);
        }
        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.EMERGENCY_PAUSE);
    }

    /**
     * @notice Receives an unpause from another chain.
     * @dev Called by CrossChainMessenger after FROST signature verification.
     */
    function receiveRemoteUnpause(
        bytes32 eventId,
        uint16 sourceChain
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        processedCrossChainEvents[eventId] = true;

        if (isPaused) {
            isPaused = false;
            emit Unpaused(eventId);
        }
        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.UNPAUSE);
    }

    /**
     * @notice Receives a blacklist action from another chain.
     * @dev Called by CrossChainMessenger after FROST signature verification.
     */
    function receiveRemoteBlacklist(
        bytes32 eventId,
        uint16 sourceChain,
        address target
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        require(target != address(0), "Invalid target address");
        processedCrossChainEvents[eventId] = true;

        if (!blacklistedAddresses[target]) {
            blacklistedAddresses[target] = true;
            emit AddressBlacklisted(target, eventId);
        }
        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.BLACKLIST_ADDRESS);
    }

    /**
     * @notice Receives an unblacklist action from another chain.
     * @dev Called by CrossChainMessenger after FROST signature verification.
     */
    function receiveRemoteUnblacklist(
        bytes32 eventId,
        uint16 sourceChain,
        address target
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        require(target != address(0), "Invalid target address");
        processedCrossChainEvents[eventId] = true;

        if (blacklistedAddresses[target]) {
            blacklistedAddresses[target] = false;
            emit AddressUnblacklisted(target, eventId);
        }
        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.BLACKLIST_ADDRESS);
    }

    /**
     * @notice Receives a threshold increase from another chain.
     * @dev Called by CrossChainMessenger after FROST signature verification.
     */
    function receiveRemoteThresholdIncrease(
        bytes32 eventId,
        uint16 sourceChain
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        processedCrossChainEvents[eventId] = true;

        if (currentThreshold < 10) {
            uint8 oldThreshold = currentThreshold;
            currentThreshold++;
            emit ThresholdIncreased(oldThreshold, currentThreshold, eventId);
        }
        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.THRESHOLD_INCREASE);
    }

    /**
     * @notice Receives a monitor-only event from another chain.
     * @dev No on-chain action, just logs the event. Guardian nodes react off-chain.
     */
    function receiveRemoteMonitor(
        bytes32 eventId,
        uint16 sourceChain
    ) external onlyCrossChainMessenger {
        require(!processedCrossChainEvents[eventId], "Event already processed");
        processedCrossChainEvents[eventId] = true;

        emit CrossChainEventReceived(eventId, sourceChain, SecurityAction.MONITOR_ONLY);
    }

    /**
     * @notice Check if a cross-chain event has been processed.
     */
    function isCrossChainEventProcessed(bytes32 eventId) external view returns (bool) {
        return processedCrossChainEvents[eventId];
    }
}
