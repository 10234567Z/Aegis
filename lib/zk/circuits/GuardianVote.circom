pragma circom 2.1.8;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/escalarmulany.circom";

/*
 * Proves that a voter:
 *   1. Is a valid guardians
 *   2. Owns the priv key for that guardian slot
 *   3. Their revealed vote matches the commitment they submitted earlier
 *   4. The vote value is valid - (0=reject, 1=approve, 2=abstain)
 * 
 * Without revealing:
 *   - Which guardian they are
 *   - What they voted, until reveal phase reads the public input
 */ 

template GuardianVote() {
    // Public Inputs
    signal input vote;                     // 0/1/2
    signal input proposalId;               // proposal being voted on
    signal input commitment;               // hash
    signal input guardianPubKeys[10][2];   // all 10 guardian public keys [x, y]

    // Private Inputs (not revealed)
    signal input guardianId;               // which guardian (0-9)
    signal input guardianSecret;           // guardian's private key
    signal input nonce;                    // randomness for commitment

    // C1
    component isLessThan= LessThan(8);
    isLessThan.in[0]<== guardianId;
    isLessThan.in[1]<== 10;
    isLessThan.out=== 1;

    // C2
    component secret_bits= Num2Bits(253);
    secret_bits.in<== guardianSecret;

    component derivePubKey= EscalarMulAny(253);
    for (var i=0; i<253; i++) {
        derivePubKey.e[i]<== secret_bits.out[i];
    }
    // Base point G for BabyJubJub
    derivePubKey.p[0]<== 995203441582195749578291179787384436505546430278305826713579947235728471134;
    derivePubKey.p[1]<== 5472060717959818805561601436314318772137091100104008585924551046643952123905;

    signal selectedPubKeyX;
    signal selectedPubKeyY;

    component muxX= Mux1(10);
    component muxY= Mux1(10);
    for (var i=0; i<10; i++) {
        muxX.c[i]<== guardianPubKeys[i][0]; // X coordinate
        muxY.c[i]<== guardianPubKeys[i][1]; // Y 
    }
    muxX.s<== guardianId;
    muxY.s<== guardianId;
    selectedPubKeyX<== muxX.out;
    selectedPubKeyY<== muxY.out;

    derivePubKey.out[0]=== selectedPubKeyX;
    derivePubKey.out[1]=== selectedPubKeyY;

    // C3
    component voteRange= LessThan(8);
    voteRange.in[0]<== vote;
    voteRange.in[1]<== 3;
    voteRange.out=== 1;

    // C4
    component commitHash= Poseidon(4);
    commitHash.inputs[0]<== guardianId;
    commitHash.inputs[1]<== vote;
    commitHash.inputs[2]<== nonce;
    commitHash.inputs[3]<== proposalId;

    commitHash.out=== commitment;
}

// Mux1 — selects one element from an array using an index signal
template Mux1(N) {
    signal input c[N];
    signal input s;
    signal output out;
    signal indicators[N];
    signal sum;

    for (var i=0; i<N; i++) {
        indicators[i]<-- (s== i) ? 1 : 0;
        indicators[i]* (indicators[i]- 1) === 0;  // boolean constraint
    }
    // Ensure exactly one indicator is 1
    signal partial_sums[N];
    partial_sums[0]<== indicators[0];
    for (var i=1; i<N; i++) {
        partial_sums[i]<== partial_sums[i-1] + indicators[i];
    }
    sum<== partial_sums[N-1];
    sum=== 1;  // exactly one indicator should be 1

    // Calculate output as the selected element
    signal partial_results[N];
    partial_results[0]<==indicators[0]* c[0];
    for (var i=1; i<N; i++) {
        partial_results[i]<== partial_results[i-1] + (indicators[i] * c[i]);
    }
    out <== partial_results[N-1];
}

component main {public [proposalId, commitment, guardianPubKeys, vote]} = GuardianVote();
