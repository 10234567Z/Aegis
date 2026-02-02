pragma circomlib MatrixRep;
include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";
include "node_modules/circomlib/circuits/escalarmul.circom";

/*
 * Proves that a voter:
 *   1. Is one of the 10 valid guardians (ID in range 0–9)
 *   2. Owns the private key for that guardian slot
 *   3. Their revealed vote matches the commitment they submitted earlier
 *   4. The vote value is valid - (0=reject, 1=approve, 2=abstain)
 * 
 * Without revealing:
 *   - Which guardian they are
 *   - What they voted, until reveal phase reads the public input
 */ 

template GuardianVote() {
    // Private Inputs
    signal private input guardianId;       // 0–9
    signal private input guardianSecret;   // secret key for this guardian slot
    signal private input vote;             // 0/1/2
    signal private input nonce;            // random value used in commitment

    // Public Inputs
    signal input proposalId;               // which proposal is being voted on
    signal input commitment;               // hash submitted during commit phase
    signal input guardianPubKeys[10];      // all 10 guardian public keys (Poseidon derived)

    // C1
    component isLessThan = LessThan(8);
    isLessThan.in[0] <== guardianId;
    isLessThan.in[1] <== 10;
    isLessThan.out === 1;

    // C2: Private key matches guardians public key
    component derivePubKey = Poseidon(1);
    derivePubKey.inputs[0] <== guardianSecret;
    component mux = Mux1(10);       // Select correct public key from the array using guardianId
    for (var i = 0; i < 10; i++) {
        mux.c[i] <== guardianPubKeys[i];
    }
    mux.s <== guardianId;
    derivePubKey.out === mux.out;   // Derived key must match the selected guardians public key


    // C3
    component voteRange = LessThan(8);
    voteRange.in[0] <== vote;
    voteRange.in[1] <== 3;
    voteRange.out === 1;

    // C4: Commitment===Hash(guardianId, vote, nonce,proposalId)
    component commitHash = Poseidon(4);
    commitHash.inputs[0] <== guardianId;
    commitHash.inputs[1] <== vote;
    commitHash.inputs[2] <== nonce;
    commitHash.inputs[3] <== proposalId;

    commitHash.out === commitment;

    signal output revealedVote;
    revealedVote <== vote;
}

// Mux1 —selects one element from an array using an index signal, needed as circom doesnt support dynamic array indexing
template Mux1(N) {
    signal input c[N];
    signal input s;
    signal output out;

    component idx = Num2Bits(8);
    idx.in <== s;
    // Binary decomposition of index -> then weighted sum
    var sum = 0;
    for (var i = 0; i < N; i++) {
        sum += c[i] * (s === i ? 1 : 0);
    }

    signal indicators[N];
    var total = 0;
    for (var i = 0; i < N; i++) {
        indicators[i] <-- (s === i) ? 1 : 0;
        indicators[i] * (indicators[i] - 1) === 0;  // boolean constraint
        total += indicators[i];
    }
    total === 1;  // exactly one indicator should be 1

    // Output -> selected element
    var result = 0;
    for (var i = 0; i < N; i++) {
        result += indicators[i] * c[i];
    }
    out <== result;
}

component main = GuardianVote();
