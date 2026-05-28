---
name: benchmark-constrained-delivery
description: Use this skill when the user wants to measure the runtime cost of constrained vs unconstrained note delivery in the MarketplaceC2D contract, when comparing C2D marketplace performance across Aztec versions, or when reproducing the C2D POC's end-to-end benchmark numbers. Covers the full build pipeline (Noir compile, prefix strip, Docker AVM postprocess, codegen), how to run the e2e Jest test, how to switch between constrained and unconstrained delivery, and includes the May 2026 baseline measurements on a Surface ARM with Aztec v4.1.0-rc.2.
---

# Benchmark: constrained vs unconstrained delivery cost

This skill is a reproducible recipe for measuring the runtime cost of constrained note delivery in the C2D marketplace.

Context: at the time of writing (May 2026), the `MessageDelivery.ONCHAIN_CONSTRAINED` flag in Aztec is recorded by the protocol but the underlying in-circuit encryption (AES-GCM or successor) is not yet fully implemented. The flag is forward-looking. Constrained delivery is on the Aztec Labs Q1 2026 roadmap with a planned ship date around 2026-06-24 ([source](https://forum.aztec.network/t/aztec-labs-aztec-core-contributor-report-q1-2026/8578#p-30024-constrained-delivery-by-2026-06-24-9)). When that lands, this recipe lets us measure the actual cost of constrained vs unconstrained delivery in the marketplace flow.

## What this measures

The end-to-end Jest test (`c2d/test/e2e/marketplace_c2d.test.ts`) runs the full C2D flow: deploy accounts and contracts, seller creates a listing, buyer locks payment, seller submits a proof via `deliver_query_result`, contract verifies via `verify_honk_proof` and atomically releases payment. The happy-path test's wall-clock time is the primary measurement. Most of that time is the PXE generating the protocol-level proof of the contract call. Both `lock_payment` (which delivers an escrow note to the seller) and `deliver_query_result` (which delivers a result note to the buyer) currently use `ONCHAIN_CONSTRAINED`.

Two comparisons are useful:

1. **Constrained vs unconstrained on the same Aztec version.** Flip the flags in the contract, recompile, rerun. The delta is the cost of constrained encryption in-circuit.
2. **Current Aztec version (mocked) vs future Aztec version (real implementation), with the same `ONCHAIN_CONSTRAINED` flag.** No contract changes. The delta is the cost the implementation adds when it lands.

Both deltas are likely small while constrained is mocked (the current baseline should match unconstrained on this version, give or take noise). Once the real implementation ships, comparison 2 becomes the interesting one.

## Prerequisites

- Aztec CLI matching the version under test. Current baseline used Aztec v4.1.0-rc.2.
- Nargo matching that Aztec version's expected compiler.
- Docker. Used for the AVM postprocess step when running on ARM (the native ARM `bb` ships with AVM transpiler disabled). May not be needed on x86 Linux.
- Node.js v22 or later for the test runner.
- `jq` for the prefix-strip step (used by Aztec's own scripts).
- ~12GB RAM available to the test environment. On WSL, raise the memory cap in `~/.wslconfig` if needed; the default 50% can OOM on 16GB systems.

## File locations

- Contract source: `c2d/contracts/marketplace_c2d/src/main.nr`
- Test source: `c2d/test/e2e/marketplace_c2d.test.ts`
- Offchain circuit (for the proof fixtures): `c2d/offchain-circuit/`
- Generated artifacts: `c2d/test/artifacts/MarketplaceC2D.ts`, `c2d/contracts/marketplace_c2d/target/`

## Build pipeline

Any contract change requires the full sequence below. Skipping the strip step is the most common cause of "passes compile but breaks at runtime with Unknown selector" failures.

```bash
cd c2d/contracts/marketplace_c2d

# 1. Noir compile. On native ARM, this will error at the AVM postprocess
# step with "AVM Transpiler is not enabled" - that's expected, the Noir
# compile itself succeeded.
aztec compile

# 2. Strip the __aztec_nr_internals__ prefix from the JSON ABI.
# The #[aztec] macro generates prefixed functions; the ABI needs them stripped
# before downstream tools consume it. Aztec ships the same script at
# noir-projects/noir-contracts/scripts/strip_aztec_nr_prefix.sh.
jq '.functions |= map(.name |= sub("^__aztec_nr_internals__"; ""))' \
  target/marketplace_c2d_contract-MarketplaceC2D.json > target/.stripped.json
mv target/.stripped.json target/marketplace_c2d_contract-MarketplaceC2D.json

# 3. Docker postprocess: real AVM transpilation. Only needed on ARM; on x86,
# step 1's postprocess should succeed natively.
docker run --rm -v "$(pwd)":/work -w /work \
  --entrypoint /usr/src/barretenberg/ts/build/arm64-linux/bb \
  aztecprotocol/aztec:<aztec-version> \
  aztec_process -i target/marketplace_c2d_contract-MarketplaceC2D.json

# 4. Codegen TypeScript bindings consumed by the test.
aztec codegen target/marketplace_c2d_contract-MarketplaceC2D.json \
  -o ../../test/artifacts
```

Replace `<aztec-version>` with the version under test (e.g. `4.1.0-rc.2`).

## Running the test

In one terminal:

```bash
rm -rf ~/.aztec/store
aztec start --local-network
```

Wait for the sandbox to initialise (logs settle, "listening on" message).

In another terminal:

```bash
cd c2d/test
npm install   # first time only
rm -rf store/pxe   # if running again after an earlier session
npm test
```

The test takes 60-100 seconds total. Run it twice and discard the first run's numbers if you want to exclude JIT warmup effects.

## Reading out the numbers

Jest reports per-test times at the end of the run. Capture:

- The total suite time
- The happy path test time (line begins `* end-to-end: list, lock, deliver-with-proof, payment releases`)
- The three negative test times if those are also of interest

The happy path is the primary metric. Run 2-3 times and take the median given ~20% run-to-run variance.

## Switching between constrained and unconstrained

Two lines in `c2d/contracts/marketplace_c2d/src/main.nr`:

1. Inside `lock_payment`, at the escrow note insert:
   ```rust
   .deliver(MessageDelivery.ONCHAIN_CONSTRAINED);   // <-- this
   ```

2. Inside `deliver_query_result`, at the result note insert:
   ```rust
   .deliver(MessageDelivery.ONCHAIN_CONSTRAINED);   // <-- and this
   ```

Flip both to `ONCHAIN_UNCONSTRAINED`, then rebuild via the full pipeline above and rerun the test.

The listing note delivery in `create_listing` is also constrained, but the seller is delivering to themselves, so it's not interesting for the constrained-cost question. Leave it constrained.

## Baseline measurements

Captured 2026-05-14.

- **Machine:** Microsoft Surface ARM, 16GB system RAM, WSL2 Ubuntu 24, 12GB allocated to WSL.
- **Aztec version:** v4.1.0-rc.2.
- **Constrained delivery status:** mocked (per Artem Grigor, Aztec Labs).
- **Contract state:** `ONCHAIN_CONSTRAINED` for both escrow and result deliveries.

| Test                                    | Run 1 | Run 2 |
|-----------------------------------------|------:|------:|
| Happy path                              | 16.6s | 20.7s |
| Rejects wrong result_value              |  9.5s | 13.3s |
| Rejects mismatched H(D)                 | 14.2s | 12.3s |
| Rejects refund before deadline          | 11.8s | 10.2s |
| **Total suite**                         | 92.5s | 95.4s |

Variance ~20% per test. The happy path's ~20s wall clock is the headline number.

When the real constrained implementation lands, the expectation is that the happy path runtime grows because the contract circuit now includes in-circuit encryption work. The size of that delta is the empirical question.

## Notes for future runs

1. **Bump Aztec version in `Nargo.toml` first.** The contract's `aztec`, `token`, and `bb_proof_verification` dependencies are pinned to v4.1.0-rc.2. Update those tags to the version under test. Without updating, the measurement will run the same mocked-constrained code.

2. **Update Aztec CLI and Nargo to match.** Mismatched compiler and protocol versions produce confusing errors. Stay aligned across CLI, Nargo, and Nargo.toml dependency tags.

3. **The proof fixtures may need regeneration.** If the Aztec version bumps the proof format or the `verify_honk_proof` interface, the offchain circuit's `target/proof/*.json` fixtures in `c2d/test/fixtures/` will no longer be compatible. To regenerate, follow the offchain circuit's pipeline (`nargo compile`, `nargo execute`, `bb prove`) and copy via `c2d/test/scripts/refresh_fixtures.sh`. Documentation in `c2d/offchain-circuit/` (or the project's main C2D documentation) covers this.

4. **Sandbox state can drift over long sessions.** "Invalid expiration timestamp" errors at deploy time usually mean stale state. Reset with `rm -rf ~/.aztec/store && aztec start --local-network`.

5. **WSL OOM-kills can wipe the test environment partway.** If WSL itself terminates during the test (you get dropped back to `C:\>`), reduce circuit sizes or raise the WSL memory cap.

## Provenance

Recipe and baseline produced as part of the C2D POC implementation in May 2026 (Vijon Baraku, Nethermind internship). Constrained-delivery prompt from Artem Grigor.