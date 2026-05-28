// C2D Phase A aggregator circuit.
//
// Verifies four chunk proofs and composes their outputs into the dataset's
// final result. From the marketplace contract's perspective, the proof this
// circuit produces is indistinguishable from a single-shot proof: same
// public-input shape, same VK consumption pattern.
//
// Public inputs (matched by the marketplace contract):
//   [0] h_d             dataset commitment, root of the full Merkle tree
//   [1] params_hash     Poseidon2(query_type_id, window_days)
//   [2] average_value   integer-floor average across all chunks
//   [3] window_days     query parameter (Phase A: always 30)
//
// Private inputs:
//   child_proofs        the four chunk proofs
//   child_vks           the four chunk verification keys (all identical)
//   child_public_inputs the four chunk public-input arrays
//
// Each child_public_inputs[i] is [chunk_index, subtree_root, partial_sum],
// matching the chunk circuit's public-input order.
//
// Scope notes:
// - CHUNK_VK_HASH is hardcoded. The aggregator binary is committed to a
//   specific compiled chunk circuit; recompiling the chunk forces an
//   aggregator recompile.
// - FAN_IN = 4 and CHUNK_SIZE = 8, pinned at compile time.

use bb_proof_verification::{
    UltraHonkVerificationKey,
    UltraHonkZKProof,
    verify_honk_proof,
};
use poseidon::poseidon2::Poseidon2;

global FAN_IN: u32 = 4;
global CHUNK_SIZE: u32 = 8;
global QUERY_TYPE_AVERAGE_OVER_WINDOW: Field = 1;

// VK hash of the chunk circuit at its current compiled state.
// Must match `jq -r '.hash' chunk/target/proof_chunkN/vk.json`.
global CHUNK_VK_HASH: Field =
    0x024c5f2ed5c2dcec114969cad2114121913218fdfd8cd76d0e454db0326c1392;

fn main(
    // Private inputs: four chunk proofs, their VKs, and their public inputs.
    child_proofs: [UltraHonkZKProof; FAN_IN],
    child_vks: [UltraHonkVerificationKey; FAN_IN],
    child_public_inputs: [[Field; 3]; FAN_IN],
    // Public inputs.
    h_d: pub Field,
    params_hash: pub Field,
    average_value: pub u32,
    window_days: pub Field,
) {
    // ---- 1. Verify each chunk proof against the pinned VK hash ----
    for i in 0..FAN_IN {
        verify_honk_proof(
            child_vks[i],
            child_proofs[i],
            child_public_inputs[i],
            CHUNK_VK_HASH,
        );
    }

    // ---- 2. Coverage: chunks are 0, 1, 2, 3 in order ----
    //
    // child_public_inputs[i][0] is the chunk_index emitted by chunk i.
    // We assert each one matches its position. This is what rules out the
    // "seven copies of the same chunk" attack: each slot must be filled by
    // a proof that committed to that specific chunk_index.
    for i in 0..FAN_IN {
        assert(child_public_inputs[i][0] == i as Field);
    }

    // ---- 3. Compose subtree roots into H(D) ----
    //
    // Each chunk's subtree_root is child_public_inputs[i][1]. We build a
    // depth-2 Merkle tree over these four roots using the same Poseidon2
    // construction the chunk uses internally. The result is H(D).
    let l1_0 = Poseidon2::hash(
        [child_public_inputs[0][1], child_public_inputs[1][1]],
        2,
    );
    let l1_1 = Poseidon2::hash(
        [child_public_inputs[2][1], child_public_inputs[3][1]],
        2,
    );
    let computed_h_d = Poseidon2::hash([l1_0, l1_1], 2);
    assert(computed_h_d == h_d);

    // ---- 4. Sum partials and check integer-floor average ----
    //
    // child_public_inputs[i][2] is the partial_sum from chunk i, as a Field.
    // We convert each back to u32 (safe: chunks bound their sums at compile
    // time via u32 readings) and sum.
    let mut total_sum: u32 = 0;
    for i in 0..FAN_IN {
        total_sum = total_sum + (child_public_inputs[i][2] as u32);
    }
    let total_count: u32 = FAN_IN * CHUNK_SIZE;
    let expected_average = total_sum / total_count;
    assert(average_value == expected_average);

    // ---- 5. Bind the parameters hash ----
    let computed_params_hash = Poseidon2::hash(
        [QUERY_TYPE_AVERAGE_OVER_WINDOW, window_days],
        2,
    );
    assert(computed_params_hash == params_hash);
}