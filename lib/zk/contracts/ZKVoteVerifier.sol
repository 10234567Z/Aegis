// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ZKVoteVerifier
 * @notice On-chain verifier for Guardian private voting ZK proofs.
 *
 * Flow:
 *   0. GuardianRegistry creates proposal → triggers createProposal()
 *   1. Commit phase (30 seconds): guardians submit commitment hash
 *   2. Reveal phase: guardians submit (vote, zkProof)
 *   3. This contract verifies the proof proves:
 *        - Voter is one of 10 valid guardians
 *        - Vote matches their earlier commitment
 *        - Vote is valid (0/1/2)
 *      WITHOUT revealing which guardian voted.
 *   4. Contract tallies votes, emits result when threshold reached.
 *   5. GuardianRegistry listens for ProposalFinalized → triggers FROST signing
 *
 * Integration:
 *   - Only GuardianRegistry can create proposals
 *   - Guardian addresses are bound to slots (slot 0 = address X)
 *   - submitCommitment checks msg.sender matches guardian slot
 */

interface IGroth16Verifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[23] calldata _pubSignals
    ) external view returns (bool);
}

contract ZKVoteVerifier {

    // ─── Events ───
    event ProposalCreated(bytes32 indexed proposalId, uint256 commitDeadline, string description);
    event CommitmentSubmitted(bytes32 indexed proposalId, uint8 indexed guardianSlot, bytes32 commitment);
    event VoteRevealed(bytes32 indexed proposalId, uint8 vote);  // does NOT reveal which guardian
    event ProposalFinalized(bytes32 indexed proposalId, uint8 approvals, uint8 rejections, uint8 abstentions, bool passed);

    // ─── State ───
    IGroth16Verifier public verifier;              // compiled Groth16 verifier contract
    uint256[10][2] public guardianPubKeys;         // all 10 guardian public keys [x, y]
    address[10] public guardianAddresses;          // wallet address per guardian slot
    uint8 public threshold;                        // e.g., 7
    address public guardianRegistry;               // only this contract can create proposals

    uint256 public constant COMMIT_PHASE_DURATION = 5 minutes;  // time to commit votes

    // Per-proposal state
    struct Proposal {
        bytes32[10] commitments;                   // commitment per guardian slot (filled during commit)
        bool[10] committed;                        // which slots have committed
        bool[10] revealed;                         // which slots have revealed
        uint8 commitCount;
        uint8 approvals;
        uint8 rejections;
        uint8 abstentions;
        uint8 revealCount;
        bool finalized;
        uint256 commitDeadline;                    // when commit phase ends
        bool exists;                               // proposal exists flag
    }

    mapping(bytes32 => Proposal) public proposals;

    // ─── Modifiers ───
    modifier onlyGuardianRegistry() {
        require(msg.sender == guardianRegistry, "Only GuardianRegistry");
        _;
    }

    modifier onlyGuardian(uint8 slot) {
        require(slot < 10, "Invalid guardian slot");
        require(msg.sender == guardianAddresses[slot], "Not authorized for this slot");
        _;
    }

    // ─── Constructor ───
    constructor(
        address _verifier,
        address _guardianRegistry,
        uint256[10][2] memory _guardianPubKeys,
        address[10] memory _guardianAddresses,
        uint8 _threshold
    ) {
        verifier = IGroth16Verifier(_verifier);
        guardianRegistry = _guardianRegistry;
        guardianPubKeys = _guardianPubKeys;
        guardianAddresses = _guardianAddresses;
        threshold = _threshold;
    }

    // ─── Proposal Creation ───
    /**
     * @notice Creates a new proposal for voting.
     * @dev Only callable by GuardianRegistry when ML bot flags an attack or guardians initiate vote.
     * @param proposalId Unique identifier for this proposal.
     * @param description Human-readable description (e.g., "Flash loan attack on Polygon").
     */
    function createProposal(
        bytes32 proposalId,
        string calldata description
    ) external onlyGuardianRegistry {
        require(!proposals[proposalId].exists, "Proposal already exists");

        Proposal storage p = proposals[proposalId];
        p.commitDeadline = block.timestamp + COMMIT_PHASE_DURATION;
        p.exists = true;

        emit ProposalCreated(proposalId, p.commitDeadline, description);
    }

    // ─── Commit Phase ───
    /**
     * @notice Guardian submits a commitment hash.
     * @dev msg.sender must match the guardian address for the claimed slot.
     * @param proposalId  The proposal being voted on.
     * @param commitment  Hash(guardianId || vote || nonce || proposalId) — computed off-chain.
     * @param guardianSlot The guardian's slot index (0–9). Must match msg.sender.
     */
    function submitCommitment(
        bytes32 proposalId,
        bytes32 commitment,
        uint8 guardianSlot
    ) external onlyGuardian(guardianSlot) {
        Proposal storage p = proposals[proposalId];

        require(p.exists, "Proposal does not exist");
        require(block.timestamp <= p.commitDeadline, "Commit phase ended");
        require(!p.committed[guardianSlot], "Slot already committed");
        require(!p.finalized, "Proposal already finalized");

        p.commitments[guardianSlot] = commitment;
        p.committed[guardianSlot] = true;
        p.commitCount++;

        emit CommitmentSubmitted(proposalId, guardianSlot, commitment);
    }

    // ─── Reveal Phase ───
    /**
     * @notice Guardian reveals their vote with a ZK proof.
     *
     * The proof verifies (without revealing guardianId):
     *   - Voter owns one of the 10 guardian keys
     *   - Their vote matches a commitment already on-chain
     *   - Vote is 0, 1, or 2
     *
     * @dev Can only reveal after commit deadline passes.
     *
     * @param proposalId   The proposal being voted on.
     * @param guardianSlot The guardian's slot (0–9). Contract checks commitment matches.
     * @param vote         0=REJECT, 1=APPROVE, 2=ABSTAIN
     * @param pA           Groth16 proof component A
     * @param pB           Groth16 proof component B
     * @param pC           Groth16 proof component C
     */
    function revealVote(
        bytes32 proposalId,
        uint8 guardianSlot,
        uint8 vote,
        uint[2] memory pA,
        uint[2][2] memory pB,
        uint[2] memory pC
    ) external onlyGuardian(guardianSlot) {
        Proposal storage p = proposals[proposalId];

        require(p.exists, "Proposal does not exist");
        require(block.timestamp > p.commitDeadline, "Commit phase still active");
        require(p.committed[guardianSlot], "This slot has not committed");
        require(!p.revealed[guardianSlot], "This slot already revealed");
        require(!p.finalized, "Proposal already finalized");
        require(vote < 3, "Invalid vote value");

        // ─── Build public inputs for ZK verification ───
        // Order must match the circuit's public input declaration order:
        //   [proposalId, commitment, guardianPubKeys[0..9][x,y], revealedVote]
        uint[23] memory pubInput;
        pubInput[0]  = uint256(proposalId);
        pubInput[1]  = uint256(p.commitments[guardianSlot]);
        
        uint k = 2;
        for (uint i = 0; i < 10; i++) {
            pubInput[k++] = guardianPubKeys[i][0]; // x
            pubInput[k++] = guardianPubKeys[i][1]; // y
        }
        
        pubInput[22] = uint256(vote);

        // ─── Verify ZK proof ───
        require(
            verifier.verifyProof(pA, pB, pC, pubInput),
            "ZK proof verification failed"
        );

        // ─── Mark as revealed ───
        p.revealed[guardianSlot] = true;

        // ─── Tally vote ───
        if (vote == 0) p.rejections++;
        else if (vote == 1) p.approvals++;
        else p.abstentions++;

        p.revealCount++;

        emit VoteRevealed(proposalId, vote);

        // ─── Auto-finalize if threshold reached or all revealed ───
        if (p.approvals >= threshold || p.revealCount == p.commitCount) {
            _finalize(proposalId);
        }
    }

    // ─── Finalization ───
    function _finalize(bytes32 proposalId) internal {
        Proposal storage p = proposals[proposalId];
        require(!p.finalized, "Already finalized");

        p.finalized = true;
        bool passed = p.approvals >= threshold;

        emit ProposalFinalized(
            proposalId,
            p.approvals,
            p.rejections,
            p.abstentions,
            passed
        );

        // If passed → GuardianRegistry picks up this event
        // and triggers FROST signing off-chain
    }

    // ─── Views ───
    function getProposalState(bytes32 proposalId) external view returns (
        uint8 commitCount,
        uint8 revealCount,
        uint8 approveCount,
        uint8 rejectCount,
        uint8 abstainCount,
        bool isFinalized
    ) {
        Proposal storage p = proposals[proposalId];
        return (p.commitCount, p.revealCount, p.approvals, p.rejections, p.abstentions, p.finalized);
    }

    function isCommitted(bytes32 proposalId, uint8 guardianSlot) external view returns (bool) {
        return proposals[proposalId].committed[guardianSlot];
    }

    function proposalExists(bytes32 proposalId) external view returns (bool) {
        return proposals[proposalId].exists;
    }

    function getCommitDeadline(bytes32 proposalId) external view returns (uint256) {
        return proposals[proposalId].commitDeadline;
    }
}
