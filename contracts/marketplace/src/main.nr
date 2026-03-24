// Data Marketplace Contract - Phase 1 POC
//
// Combined marketplace + escrow contract for the personal data marketplace.
// Handles: listing creation, payment escrow, data delivery, and timeout refunds.
//
// Architecture:
//   - Listings are registered in a public index (visible metadata, no seller identity).
//   - Escrow notes are private, owned by the seller (so seller's PXE discovers them).
//   - Data notes are private, delivered to the buyer on purchase.
//   - Payment uses authwit flow against an external token contract (TODO).

use aztec::macros::aztec;

pub mod escrow_note;
pub mod data_note;

#[aztec]
pub contract Marketplace {
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
        state_vars::{Owned, Map, PublicMutable, PrivateSet},
        note::{
            note_getter_options::NoteGetterOptions,
            note_interface::NoteProperties,
        },
        utils::comparison::Comparator,
    };
    use aztec::hash::hash_args;
    use crate::escrow_note::EscrowNote;
    use crate::data_note::DataNote;
    use token::Token;

    // ---------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------

    // Public listing entry stored in the public index.
    // Kept minimal: just enough for browsing.
    // Seller identity is NOT stored here.
    #[derive(Packable)]
    pub struct ListingEntry {
        content_hash: Field,     // hash of the data committed at listing time
        price: Field,            // price in token base units
        token: AztecAddress,     // payment token address
        category: Field,         // data category (e.g. 1 = health/wearable)
        active: bool,            // whether the listing is available
    }

    #[storage]
    struct Storage<Context> {
        // Admin who can manage the contract (for POC, deployer)
        admin: PublicMutable<AztecAddress, Context>,

        // Public listing index: listing_id -> ListingEntry
        listings: Map<Field, PublicMutable<ListingEntry, Context>, Context>,

        // Counter for generating listing IDs
        next_listing_id: PublicMutable<Field, Context>,

        // Private escrow notes, owned by the seller.
        // When a buyer locks payment, an EscrowNote is created for the seller.
        // The seller nullifies it during delivery.
        escrows: Owned<PrivateSet<EscrowNote, Context>, Context>,

        // Private data notes, owned by the buyer.
        // Created during delivery with the actual data payload.
        data_notes: Owned<PrivateSet<DataNote, Context>, Context>,
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.next_listing_id.write(1);
    }

    // ---------------------------------------------------------------
    // Create Listing
    // ---------------------------------------------------------------
    // Phase 1: simplified listing - no attestation check yet (Phase 2).
    // Seller commits a content_hash and registers metadata publicly.
    //
    // Flow:
    //   1. Private: seller provides content_hash, price, token, category.
    //   2. Private function enqueues a public call to register in the index.
    //
    // NOTE: In Phase 2 we add attestation verification here.

    #[external("private")]
    fn create_listing(
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
    ) {
        // For now, just register the listing publicly.
        // The seller's identity is NOT included in the public call.
        self.enqueue_self._register_listing(content_hash, price, token, category);
    }

    #[external("public")]
    #[only_self]
    fn _register_listing(
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
    ) {
        let listing_id = self.storage.next_listing_id.read();
        self.storage.next_listing_id.write(listing_id + 1);

        let entry = ListingEntry {
            content_hash,
            price,
            token,
            category,
            active: true,
        };
        self.storage.listings.at(listing_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Lock Payment (Buyer)
    // ---------------------------------------------------------------
    // Buyer locks payment for a listing. Creates an EscrowNote for the seller.
    //
    // Flow:
    //   1. Buyer calls lock_payment with the listing_id and seller address.
    //   2. The contract uses authwit to transfer tokens from buyer to this contract.
    //   3. An EscrowNote is created in the seller's private set.
    //
    // The seller address must be known to the buyer (shared off-chain or via
    // a separate discovery mechanism). This is a deliberate design choice:
    // the public listing index does NOT reveal the seller's address.
    //
    // TODO: Wire up token transfer via authwit. For now, caller must have
    // pre-transferred tokens to this contract.

    #[external("private")]
    fn lock_payment(
        listing_id: Field,
        seller: AztecAddress,
        amount: Field,
        token: AztecAddress,
        deadline: Field,
    ) {
        let buyer = self.msg_sender();

        // Transfer tokens from buyer to this contract via authwit.
        // The buyer must have previously created an authwit allowing this contract
        // to call transfer_in_private on the token contract on their behalf.
        self.call(Token::at(token).transfer_in_private(buyer, self.address, amount as u128, 0));

        // Create the escrow note for the seller.
        let escrow = EscrowNote {
            listing_id,
            buyer,
            amount,
            token,
            deadline,
        };

        // Insert into seller's private set and deliver so seller's PXE finds it.
        // UNCONSTRAINED_ONCHAIN: seller is incentivised to find the note (they
        // want to claim payment), so constrained delivery is not needed here.
        self.storage.escrows.at(seller)
            .insert(escrow)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);
    }

    // ---------------------------------------------------------------
    // Deliver and Claim (Seller)
    // ---------------------------------------------------------------
    // Seller delivers data to the buyer and atomically claims the escrowed payment.
    //
    // Flow:
    //   1. Seller provides the escrow's listing_id to find the right EscrowNote.
    //   2. The contract verifies the content_hash matches.
    //   3. A DataNote is created for the buyer with the actual data.
    //   4. The EscrowNote is nullified (consumed).
    //   5. Payment is released to the seller.
    //
    // Steps 3-5 are all side effects of a single transaction.
    // If any step fails, the entire transaction reverts.

    #[external("private")]
    fn deliver_and_claim(
        listing_id: Field,
        buyer: AztecAddress,
        content_hash: Field,
        data_0: Field,
        data_1: Field,
        data_2: Field,
        data_3: Field,
    ) {
        let _seller = self.msg_sender();

        // 1. Verify the data matches the committed content hash.
        //    The content hash is hash(data_0, data_1, data_2, data_3).
        let computed_hash = hash_args([data_0, data_1, data_2, data_3]);
        assert(computed_hash == content_hash, "Content hash mismatch: data does not match commitment");

        // 2. Find and consume the EscrowNote for this listing + buyer.
        let options = NoteGetterOptions::<EscrowNote, 5, Field, Field>::new()
            .select(EscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(EscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let notes = self.storage.escrows.at(_seller).pop_notes(options);
        assert(notes.len() == 1, "No matching escrow note found");

        let escrow = notes.get(0);

        // 3. Create the DataNote for the buyer.
        let data = DataNote {
            listing_id,
            content_hash,
            data_0,
            data_1,
            data_2,
            data_3,
        };

        self.storage.data_notes.at(buyer)
            .insert(data)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // 4. Release payment to the seller.
        // Transfer escrowed tokens from this contract to the seller.
        self.call(Token::at(escrow.token).transfer_in_private(self.address, _seller, escrow.amount as u128, 0));

        // 5. Mark listing as inactive (prevents double-sell).
        self.enqueue_self._deactivate_listing(listing_id);
    }

    #[external("public")]
    #[only_self]
    fn _deactivate_listing(listing_id: Field) {
        let mut entry = self.storage.listings.at(listing_id).read();
        entry.active = false;
        self.storage.listings.at(listing_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Refund (Buyer)
    // ---------------------------------------------------------------
    // Buyer reclaims payment if the seller never delivers.
    // Can only be called after the deadline block has passed.

    #[external("private")]
    fn refund(listing_id: Field, seller: AztecAddress) {
        let buyer = self.msg_sender();

        // Find the escrow note.
        let options = NoteGetterOptions::<EscrowNote, 5, Field, Field>::new()
            .select(EscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(EscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let notes = self.storage.escrows.at(seller).pop_notes(options);
        assert(notes.len() == 1, "No matching escrow note found for refund");

        let escrow = notes.get(0);

        // TODO: Check deadline has passed. This needs an enqueued public check.

        // Transfer escrowed tokens back to the buyer.
        self.call(Token::at(escrow.token).transfer_in_private(self.address, buyer, escrow.amount as u128, 0));
    }

    // ---------------------------------------------------------------
    // Utility (view) functions
    // ---------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_listing(listing_id: Field) -> pub ListingEntry {
        self.storage.listings.at(listing_id).read()
    }

    #[external("utility")]
    unconstrained fn get_next_listing_id() -> pub Field {
        self.storage.next_listing_id.read()
    }
}
