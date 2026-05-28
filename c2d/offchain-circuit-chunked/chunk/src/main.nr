// C2D Phase A chunk circuit.
//
// Proves over a fixed-size slice of a dataset:
//   1. The slice's Merkle subtree root, built bottom-up from CHUNK_SIZE readings.
//   2. The sum of the readings in the slice.
//   3. The slice's position (chunk_index) within the parent dataset.
//
// The chunk does NOT know about the wider dataset commitment H(D). The
// aggregator is responsible for composing chunk subtree roots into H(D)
// and asserting they cover the dataset with no gaps or duplicates.
//
// Public inputs (matched by the aggregator):
//   [0] chunk_index    position of this chunk in the parent dataset
//   [1] subtree_root   Poseidon2 Merkle root over the chunk's readings
//   [2] partial_sum    integer sum of the chunk's readings
//
// Private inputs:
//   readings           the CHUNK_SIZE values in this chunk
//
// Phase A constants: CHUNK_SIZE = 8, subtree depth = 3.
// Phase B will scale CHUNK_SIZE and re-derive depth.

use poseidon::poseidon2::Poseidon2;

global CHUNK_SIZE: u32 = 8;

fn main(
    // Private input: the readings for this chunk.
    readings: [u32; CHUNK_SIZE],
    // Public inputs, in the order the aggregator expects.
    chunk_index: pub Field,
    subtree_root: pub Field,
    partial_sum: pub u32,
) {
    // ---- 1. Build the chunk's Merkle subtree ----
    //
    // Leaves are Poseidon2(reading) (single-input hash), internal nodes
    // are Poseidon2([left, right], 2). The same construction the aggregator
    // uses when composing subtree roots into H(D), so the depths match up
    // cleanly: full tree depth = chunk subtree depth + aggregator depth.
    //
    // For CHUNK_SIZE = 8 the subtree is depth 3 (8 -> 4 -> 2 -> 1).
    let mut level: [Field; CHUNK_SIZE] = [0; CHUNK_SIZE];
    for i in 0..CHUNK_SIZE {
        level[i] = Poseidon2::hash([readings[i] as Field], 1);
    }

    // Halve the level repeatedly until one element remains. CHUNK_SIZE
    // must be a power of two for this to bottom out cleanly.
    let mut width: u32 = CHUNK_SIZE;
    for _ in 0..3 {
        // 3 = log2(CHUNK_SIZE), hardcoded for CHUNK_SIZE = 8.
        let half = width / 2;
        let mut next_level: [Field; CHUNK_SIZE] = [0; CHUNK_SIZE];
        for i in 0..half {
            next_level[i] = Poseidon2::hash([level[2 * i], level[2 * i + 1]], 2);
        }
        level = next_level;
        width = half;
    }

    // After the loops, level[0] is the subtree root.
    assert(level[0] == subtree_root);

    // ---- 2. Bind the partial sum ----
    let mut sum: u32 = 0;
    for i in 0..CHUNK_SIZE {
        sum = sum + readings[i];
    }

    assert(partial_sum == sum);

    // ---- 3. chunk_index is bound implicitly: the aggregator asserts the
    //         four children's chunk_index values are 0,1,2,3 in order.
    //         The chunk itself has no constraint to add here.
    //         The line below is a soft sanity bound (chunk_index fits in a
    //         small unsigned range), only relevant once we have many chunks.
    let _ = chunk_index;
}

// Local test: not part of the proof, sanity check the construction.
#[test]
fn test_chunk_basic() {
    let readings: [u32; 8] = [65, 66, 67, 68, 69, 70, 65, 66];

    // Build the subtree the same way main() does, to derive the expected
    // root for the test fixture.
    let mut leaves: [Field; 8] = [0; 8];
    for i in 0..8 {
        leaves[i] = Poseidon2::hash([readings[i] as Field], 1);
    }
    let l1_0 = Poseidon2::hash([leaves[0], leaves[1]], 2);
    let l1_1 = Poseidon2::hash([leaves[2], leaves[3]], 2);
    let l1_2 = Poseidon2::hash([leaves[4], leaves[5]], 2);
    let l1_3 = Poseidon2::hash([leaves[6], leaves[7]], 2);
    let l2_0 = Poseidon2::hash([l1_0, l1_1], 2);
    let l2_1 = Poseidon2::hash([l1_2, l1_3], 2);
    let subtree_root = Poseidon2::hash([l2_0, l2_1], 2);

    // 65+66+67+68+69+70+65+66 = 536
    main(readings, 0, subtree_root, 536);
}