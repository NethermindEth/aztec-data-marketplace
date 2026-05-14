// C2D POC: average-over-window offchain circuit.
//
// Proves the seller computed the integer-floor average of N daily readings
// over a dataset they previously committed to as H(D).
//
// Public inputs (matched by the verifier contract):
//   [0] H(D)             dataset commitment, Poseidon2 over the N values
//   [1] params_hash      Poseidon2(query_type_id, window_days)
//   [2] average_value    claimed integer-floor average of the values
//
// Private inputs:
//   readings             the N values the average was computed over
//
// The circuit:
//   1. Recomputes H(D) from the private readings, asserts it matches the public H(D).
//   2. Sums the readings.
//   3. Computes the integer-floor average and asserts it equals the public average_value.
//
// Scope notes:
// - The commitment is over values only, not timestamps. The POC is for a single
//   fixed-window query; range completeness over arbitrary windows is what the
//   sorted Merkle structure in Appendix A handles, deliberately out of scope here.
// - Readings are u32-bounded; we treat them as small non-negative integers so the
//   integer-division check is sound over the Field.
// - params_hash is recomputed from the public components so the verifier
//   contract can bind it to the buyer's escrow parameters.

use poseidon::poseidon2::Poseidon2;

global N: u32 = 30;

// query_type_id is a fixed catalogue identifier for "average-over-window".
// Hardcoded for the POC; a real catalogue would assign these per entry.
global QUERY_TYPE_AVERAGE_OVER_WINDOW: Field = 1;

fn main(
    // Private input: the N values the seller used.
    readings: [u32; N],
    // Public inputs, in the order the verifier contract expects.
    h_d: pub Field,
    params_hash: pub Field,
    average_value: pub u32,
    // Public parameter component used to derive params_hash; bound by the contract.
    window_days: pub Field,
) {
    // ---- 1. Recompute and bind the dataset commitment ----
    let mut commitment_input: [Field; N] = [0; N];
    for i in 0..N {
        commitment_input[i] = readings[i] as Field;
    }
    let computed_h_d = Poseidon2::hash(commitment_input, N);
    assert(computed_h_d == h_d);

    // ---- 2. Bind the parameters hash ----
    let computed_params_hash = Poseidon2::hash(
        [QUERY_TYPE_AVERAGE_OVER_WINDOW, window_days],
        2,
    );
    assert(computed_params_hash == params_hash);

    // ---- 3. Sum and check integer-floor average ----
    let mut sum: u32 = 0;
    for i in 0..N {
        sum = sum + readings[i];
    }

    // average_value is the integer floor: sum == average_value * N + remainder,
    // with 0 <= remainder < N. Both inequalities matter for soundness.
    let expected_quotient = sum / N;
    assert(average_value == expected_quotient);
}

// Local test: not part of the proof, just sanity check for the circuit.
#[test]
fn test_average_basic() {
    let readings: [u32; 30] = [
        65, 66, 67, 68, 69,
        70, 65, 66, 67, 68,
        69, 70, 65, 66, 67,
        68, 69, 70, 65, 66,
        67, 68, 69, 70, 65,
        66, 67, 68, 69, 70,
    ];

    let mut commitment_input: [Field; 30] = [0; 30];
    for i in 0..30 {
        commitment_input[i] = readings[i] as Field;
    }
    let h_d = Poseidon2::hash(commitment_input, 30);
    let params_hash = Poseidon2::hash([1, 30], 2);

    // sum = 65*6 + 66*6 + 67*6 + 68*6 + 69*6 + 70*6 = 2025; 2025 / 30 = 67
    main(readings, h_d, params_hash, 67, 30);
}