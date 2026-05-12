# Aztec Data Marketplace

A privacy-preserving marketplace for personal data, built on Aztec Network. Individuals choose how to monetise data they hold: sell it outright, or sell the right to run a specific query against it. Buyers get cryptographically attested data or verifiable query results; sellers get atomic payment release without exposing identity, holdings, or who bought what.

Two products in one marketplace:

- **Sell your data.** Small structured data fits fully on-chain via an atomic escrow. Larger datasets sit in off-chain storage and are unlocked atomically against payment via a committed-key-reveal scheme.
- **Sell a query on your data.** Instead of releasing the data, sell the right to run a specific computation against it. The buyer receives only the result; the data never leaves the seller's device.

The first use case is personal health and wellness data (Apple HealthKit, Garmin, Oura, Fitbit), but the architecture is generic: any data category with an attestable source fits.

Personal data has two failure modes today: it's collected by platforms that monetise it without paying the individual, or it's "available for sale" through brokers in ways that strip provenance and break privacy. A marketplace where individuals are the sellers needs cryptographic provenance (buyers won't pay for data that could be fabricated), privacy (sellers won't list if listing exposes who they are or what they hold), and atomic settlement (no "paid but never delivered" or "delivered but never paid"). Aztec's private smart contract model fits this combination cleanly: custom note types for attested data, private execution that keeps participants hidden, and atomic public state transitions for payment release.

## How it works

### Selling data (Tier 1: small structured data)

For a single measurement, summary statistic, or attestation (e.g. "average resting heart rate over 30 days from Apple Watch"):

1. **Seller lists.** Submits a private function call that verifies an ECDSA P-256 signature from a registered attestor over the data's content hash, then writes a `ListingNote` to the seller's private set and a minimum-metadata entry to the public listing index. Listing names and measurement ranges sit publicly so buyers can find them; everything else stays private.
2. **Buyer locks payment.** A second private function transfers stablecoin into the contract's escrow and creates an `EscrowNote` addressed to the seller. The seller's PXE discovers it via standard note tagging.
3. **Seller delivers atomically.** A third private function recomputes the content hash from the seller's submitted data, pops both the `ListingNote` and the `EscrowNote`, creates a `DataNote` in the buyer's private set, and releases the escrowed payment. Mismatched hash, expired deadline, or any other invariant breach reverts the whole transaction.
4. **Buyer reads.** The `DataNote` arrives in the buyer's PXE through standard tagging. Decryption is local.

A refund path lets the buyer reclaim escrow after the deadline if the seller never delivers.

### Selling data (Tier 2: off-chain datasets via CKR)

For datasets too large to fit in Aztec notes (months of raw wearable data, full export bundles), the ciphertext sits in off-chain content-addressable storage (Arweave canonical, Filecoin Onchain Cloud secondary). The on-chain dance is:

1. Seller encrypts the dataset once under a random key K, uploads to storage, commits `Poseidon2(K)` and `hash(C)` on-chain, and produces a listing-time ZK proof binding K, the ciphertext, and the attested plaintext.
2. Buyer fetches the ciphertext and verifies the hash matches the on-chain commitment *before* locking payment.
3. To claim payment, seller reveals K in a transaction that atomically (a) verifies `Poseidon2(K)` matches the commitment, (b) creates a private `KeyNote` for the buyer, (c) releases escrow. Wrong key reverts.

Same K is revealed to every buyer (explicit trade-off: no leak traceability). Listing remains active across multiple sales. The scheme is internally called CKR (Committed Key Reveal).

### Selling a query (Compute-to-Data)

For buyers who want answers, not data:

1. Seller commits to their dataset via a Merkle root `H(D)` signed by an attestor. Picks which catalogue entries (query types: averages, threshold checks, correlations, etc.) they want to support.
2. Buyer picks a permitted catalogue entry, chooses parameters, locks payment. The buyer cannot pay for a query the seller hasn't enabled.
3. Seller's client computes the result locally, generates an UltraHonk proof binding the result to `H(D)` via the committed dataset structure, and submits the proof.
4. Marketplace contract verifies the proof via `verify_honk_proof`, encrypts the result for the buyer in a private `ResultNote`, releases payment atomically.
5. Buyer decrypts the result locally. The data never leaves the seller's device.

The catalogue is a fixed public registry of permitted query types pinned to specific compiled circuits' VK hashes, mirroring the pattern Ocean and Vana converged on for the same reason: arbitrary buyer-submitted code is a data exfiltration vector. For datasets large enough that a single circuit won't fit on consumer prover hardware, queries are chunked across leaf and aggregator circuits, mirroring Aztec's own `parity-root` pattern.

## Implementation status

Tier 1 (sell your data, small structured) is implemented and demoed end-to-end: six functions, three custom note types, separate attestor registry contract, web client running a PXE in the browser, e2e tests covering happy path and four failure modes. Demo walkthrough in `docs/DEMO.md`.

CKR and C2D are designed in detail (see Notion docs linked below) but not yet implemented. The next planned milestone is a C2D POC for a single catalogue entry.

Tier 1 has a small set of known gaps, tracked in the design doc:

- Partial notes for seller and buyer addresses in delivery and refund (currently leaked in the public trace).
- Real App Attest integration; the contract verifies the signature correctly but the off-chain attestor service that verifies App Attest assertions is not yet built. MVP uses a local P-256 key as a stand-in.
- Apple HealthKit import pipeline.
- Backend coordination service to map `listing_id → seller_address` (currently a `localStorage` relay in the client).
- Refund UI button.

## Running it

Requires Node 20+.

**Start a local Aztec network:**
```
aztec start --local-network
```

**Compile and generate bindings** (from `contracts/marketplace/`):
```
aztec-nargo compile
aztec-postprocess-contract
aztec codegen target -o ../../test/artifacts
```

**Deploy** (from `test/`):
```
AZTEC_NODE_URL=http://localhost:8080 npm run deploy:marketplace
```

**Run the web client** (from `client/`):
```
npm run dev -- --host
```

Browser at `http://localhost:5173`. Demo walkthrough in `docs/DEMO.md`.

**Run the e2e tests:**
```
cd test && npm test
```

## Repo layout

```
contracts/
  marketplace/                Main marketplace contract (Noir)
  attestor_registry/          Public attestor registry contract
client/
  src/
    context.tsx               Wallet, account, listing-seller mapping
    screens/                  Gateway, Browse, CreateListing, Purchase, Deliver, ReceivedData
test/
  e2e/                        Jest e2e test suites
  artifacts/                  Generated TypeScript contract bindings
  scripts/                    Deployment scripts
docs/
  DEMO.md                     End-to-end demo walkthrough
```

## Design documents

The deeper design work lives in Notion:

- [Master design doc](https://www.notion.so/nethermind/Personal-Data-Marketplace-Aztec-321360fc38d080d893a9c4e4928d33bf) — full project scope, threat model, attestor strategy, address coordination
- [Tier 2 / CKR design](https://www.notion.so/nethermind/Tier-2-cryptographic-scheme-options-34b360fc38d080178103f4b815eb1ffc) — committed-key-reveal scheme with full flow and adversarial analysis
- [Storage layer](https://www.notion.so/nethermind/Tier-2-Storage-layer-comparison-351360fc38d0803085ebe65f8dcd6dad) — Arweave / Filecoin OC comparison and rationale
- [C2D research](https://www.notion.so/nethermind/Compute-to-Data-research-353360fc38d08047ae06cced59d86108) — lit review of Ocean, Vana, Zama, KRAKEN, zkFL-Health; architecture; dataset commitment and chunked aggregation appendices
