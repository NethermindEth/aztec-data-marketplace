// MarketplaceC2D - Compute-to-Data marketplace contract (POC).
//
// Demonstrates the C2D flow on Aztec end-to-end:
//   1. Seller creates a listing committing to a dataset H(D).
//   2. Buyer locks payment against the listing.
//   3. Seller submits an UltraHonk proof that they ran a permitted query on
//      data hashing to H(D). The proof is verified via verify_honk_proof
//      inside the private function. On success, payment releases to the
//      seller and a result note is created for the buyer, atomically.
//   4. Buyer can refund after the deadline if the seller never delivers.
//
// Scope notes:
// - One catalogue entry hardcoded (average-over-window). The query's VK hash
//   is stored as PublicImmutable at deploy time.
// - No attestor signature verification. The seller's H(D) is trusted to be
//   theirs. In a full deployment this would be checked at create_listing
//   time, same way Tier 1 does it.
// - One contract instance = one query type. Future versions would store a
//   map of catalogue entries keyed by query type id.

use aztec::macros::aztec;

pub mod c2d_listing_note;
pub mod c2d_escrow_note;
pub mod c2d_result_note;

#[aztec]
pub contract MarketplaceC2D {
    use aztec::{
        macros::{
            functions::{external, initializer, only_self},
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        protocol::{
            address::AztecAddress,
            traits::{ToField, Packable},
        },
        state_vars::{Map, Owned, PrivateSet, PublicImmutable, PublicMutable},
        note::{
            note_getter_options::NoteGetterOptions,
            note_interface::NoteProperties,
        },
        utils::comparison::Comparator,
    };
    use bb_proof_verification::{UltraHonkVerificationKey, UltraHonkZKProof, verify_honk_proof};
    use crate::c2d_listing_note::C2DListingNote;
    use crate::c2d_escrow_note::C2DEscrowNote;
    use crate::c2d_result_note::C2DResultNote;
    use token::Token;

    global MIN_DEADLINE_BLOCKS: u32 = 100;

    // Public listing entry. No seller address (privacy: tracked off-chain
    // via the backend relay, same as Tier 1).
    #[derive(Packable)]
    pub struct C2DListingEntry {
        pub h_d: Field,
        pub price: Field,
        pub token: AztecAddress,
        pub active: bool,
    }

    #[storage]
    struct Storage<Context> {
        // Pinned VK hash for the catalogue's single query type. Set once
        // at deploy time, never changes.
        vk_hash: PublicImmutable<Field, Context>,

        // Monotonically increasing listing counter.
        next_listing_id: PublicMutable<Field, Context>,

        // Public index of listings, keyed by listing_id.
        listings: Map<Field, PublicMutable<C2DListingEntry, Context>, Context>,

        // Seller's private set of their own listing notes. Read non-consuming
        // on each delivery so a listing can be queried by many buyers.
        listing_notes: Owned<PrivateSet<C2DListingNote, Context>, Context>,

        // Seller's private set of escrow notes; the seller's PXE discovers
        // these when buyers lock payment.
        escrows: Owned<PrivateSet<C2DEscrowNote, Context>, Context>,

        // Buyer's private set of delivered result notes.
        results: Owned<PrivateSet<C2DResultNote, Context>, Context>,
    }

    // -----------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------
    //
    // vk_hash is the hash of the verification key for the offchain Noir
    // circuit that implements the catalogue's single query type. It's
    // computed by `bb prove --write_vk` and pinned here at deploy time.

    #[external("public")]
    #[initializer]
    fn constructor(vk_hash: Field) {
        self.storage.vk_hash.initialize(vk_hash);
        self.storage.next_listing_id.write(1);
    }

    // -----------------------------------------------------------------
    // Create Listing (Seller)
    // -----------------------------------------------------------------
    //
    // Seller publishes a listing committing to a dataset H(D), at a given
    // price, payable in the given token. The seller's address is captured
    // only in their private listing-note set; it does not appear in the
    // public listings index.

    #[external("private")]
    fn create_listing(h_d: Field, price: Field, token: AztecAddress) {
        let seller = self.msg_sender();

        // The listing's public id is allocated in the public phase below.
        // It cannot be referenced in the listing note (which is created in
        // private context), so the note is keyed only by h_d.
        let listing_note = C2DListingNote { h_d };

        self.storage.listing_notes.at(seller)
            .insert(listing_note)
            .deliver(MessageDelivery.ONCHAIN_CONSTRAINED);

        self.enqueue_self._register_listing(h_d, price, token);
    }

    #[external("public")]
    #[only_self]
    fn _register_listing(h_d: Field, price: Field, token: AztecAddress) {
        let listing_id = self.storage.next_listing_id.read();

        let entry = C2DListingEntry {
            h_d,
            price,
            token,
            active: true,
        };

        self.storage.listings.at(listing_id).write(entry);
        self.storage.next_listing_id.write(listing_id + 1);
    }

    // -----------------------------------------------------------------
    // Lock Payment (Buyer)
    // -----------------------------------------------------------------
    //
    // Buyer transfers `amount` of `token` to the marketplace contract, with
    // the seller's address tagged into the escrow note so the seller's PXE
    // can discover it. Buyer also passes the listing id and a deadline.

    #[external("private")]
    fn lock_payment(
        listing_id: Field,
        seller: AztecAddress,
        amount: Field,
        token: AztecAddress,
        deadline: Field,
    ) {
        let buyer = self.msg_sender();

        self.call(Token::at(token).transfer_to_public(buyer, self.address, amount as u128, 0));

        let escrow = C2DEscrowNote {
            listing_id,
            buyer,
            amount,
            token,
            deadline,
        };

        self.enqueue_self._check_min_deadline(deadline);

        self.storage.escrows.at(seller)
            .insert(escrow)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    #[external("public")]
    #[only_self]
    fn _check_min_deadline(deadline: Field) {
        let current_block = self.context.block_number();
        assert(
            deadline as u32 >= current_block + MIN_DEADLINE_BLOCKS,
            "Deadline too soon -- must be at least MIN_DEADLINE_BLOCKS in the future",
        );
    }

    // -----------------------------------------------------------------
    // Deliver Query Result (Seller)
    // -----------------------------------------------------------------
    //
    // Seller has already generated an UltraHonk proof off-chain showing
    // that running the catalogue's query against data hashing to H(D)
    // produced `result_value` for the buyer's parameters.
    //
    // Public inputs the offchain circuit emits, in order:
    //   public_inputs[0] = h_d
    //   public_inputs[1] = params_hash
    //   public_inputs[2] = result_value  (e.g. average, as a u32 in a Field)
    //   public_inputs[3] = window_days
    //
    // This function:
    //   1. Reads the seller's listing note (non-consuming) to recover H(D).
    //   2. Pops the buyer's escrow note (consuming) to recover amount and token.
    //   3. Asserts the proof's public inputs match: public_inputs[0] == H(D),
    //      and public_inputs[2] == claimed result_value.
    //   4. Verifies the proof against the pinned VK hash.
    //   5. Creates a result note in the buyer's set.
    //   6. Enqueues a public transfer of the escrowed payment to the seller.
    //
    // All atomic: if any step fails, the whole transaction reverts.

    #[external("private")]
    fn deliver_query_result(
        listing_id: Field,
        buyer: AztecAddress,
        h_d: Field,
        result_value: Field,
        verification_key: UltraHonkVerificationKey,
        proof: UltraHonkZKProof,
        public_inputs: [Field; 4],
    ) {
        let seller = self.msg_sender();

        // 1. Find the seller's listing note by h_d. Non-consuming so the
        //    listing stays alive for future buyers. The listing note can't
        //    be keyed by listing_id (assigned in the public phase, not
        //    visible from private context), so h_d is the matching key.
        let listing_options = NoteGetterOptions::<C2DListingNote, 1, Field, Field>::new()
            .select(C2DListingNote::properties().h_d, Comparator.EQ, h_d)
            .set_limit(1);

        let listing_notes = self.storage.listing_notes.at(seller).get_notes(listing_options);
        assert(listing_notes.len() == 1, "No matching listing note found");

        // 2. Pop the buyer's escrow note to recover the payment terms and
        //    prevent double-claim.
        let escrow_options = NoteGetterOptions::<C2DEscrowNote, 5, Field, Field>::new()
            .select(C2DEscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(C2DEscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let escrow_notes = self.storage.escrows.at(seller).pop_notes(escrow_options);
        assert(escrow_notes.len() == 1, "No matching escrow note found");
        let escrow = escrow_notes.get(0);

        // 3. Bind the proof's public inputs to listing state and the
        //    claimed result. This prevents the seller from submitting a
        //    proof for a different dataset or claiming a different result.
        assert(public_inputs[0] == h_d, "Proof H(D) does not match listing");
        assert(public_inputs[2] == result_value, "Proof result does not match claim");

        // 4. Verify the proof. The VK hash check inside verify_honk_proof
        //    binds the proof to the pinned catalogue circuit.
        let vk_hash = self.storage.vk_hash.read();
        verify_honk_proof(verification_key, proof, public_inputs, vk_hash);

        // 5. Deliver the result note to the buyer.
        let result_note = C2DResultNote {
            listing_id,
            result_value,
        };
        self.storage.results.at(buyer)
            .insert(result_note)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // 6. Release the escrowed payment to the seller.
        self.enqueue(Token::at(escrow.token).transfer_in_public(
            self.address,
            seller,
            escrow.amount as u128,
            0,
        ));

        // 7. Assert via public state that the buyer's listing_id matches
        //    the same h_d. Enqueued because it's a public-state read.
        self.enqueue_self._assert_listing_matches(listing_id, h_d);
    }

    #[external("public")]
    #[only_self]
    fn _assert_listing_matches(listing_id: Field, h_d: Field) {
        let entry = self.storage.listings.at(listing_id).read();
        assert(entry.h_d == h_d, "h_d does not match listing entry");
        assert(entry.active, "Listing is not active");
    }

    // -----------------------------------------------------------------
    // Refund (Buyer)
    // -----------------------------------------------------------------
    //
    // After the deadline, the buyer can reclaim their escrow if the seller
    // never delivered. Same shape as Tier 1's refund.

    #[external("private")]
    fn refund(listing_id: Field, seller: AztecAddress) {
        let buyer = self.msg_sender();

        let escrow_options = NoteGetterOptions::<C2DEscrowNote, 5, Field, Field>::new()
            .select(C2DEscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(C2DEscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let escrow_notes = self.storage.escrows.at(seller).pop_notes(escrow_options);
        assert(escrow_notes.len() == 1, "No matching escrow note found");
        let escrow = escrow_notes.get(0);

        self.enqueue_self._check_deadline_passed(escrow.deadline);

        self.enqueue(Token::at(escrow.token).transfer_in_public(
            self.address,
            buyer,
            escrow.amount as u128,
            0,
        ));
    }

    #[external("public")]
    #[only_self]
    fn _check_deadline_passed(deadline: Field) {
        let current_block = self.context.block_number();
        assert(
            current_block > deadline as u32,
            "Deadline has not passed",
        );
    }

    // -----------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_listing(listing_id: Field) -> pub C2DListingEntry {
        self.storage.listings.at(listing_id).read()
    }

    #[external("utility")]
    unconstrained fn get_next_listing_id() -> pub Field {
        self.storage.next_listing_id.read()
    }

    #[external("utility")]
    unconstrained fn get_vk_hash() -> pub Field {
        self.storage.vk_hash.read()
    }
}
