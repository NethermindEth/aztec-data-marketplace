// Data Marketplace Contract - Phase 1 POC (v3, public escrow)

use aztec::macros::aztec;

pub mod escrow_note;
pub mod data_note;
pub mod listing_note;

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
    use crate::listing_note::ListingNote;
    use token::Token;

    global MIN_DEADLINE_BLOCKS: u32 = 100;

    #[derive(Packable)]
    pub struct ListingEntry {
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
        active: bool,
    }

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        listings: Map<Field, PublicMutable<ListingEntry, Context>, Context>,
        next_listing_id: PublicMutable<Field, Context>,
        listing_notes: Owned<PrivateSet<ListingNote, Context>, Context>,
        escrows: Owned<PrivateSet<EscrowNote, Context>, Context>,
        data_notes: Owned<PrivateSet<DataNote, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.next_listing_id.write(1);
    }

    // ---------------------------------------------------------------
    // Create Listing (Seller)
    // ---------------------------------------------------------------

    #[external("private")]
    fn create_listing(
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
    ) {
        let seller = self.msg_sender();

        let listing = ListingNote {
            listing_id: 0,
            content_hash,
        };
        self.storage.listing_notes.at(seller)
            .insert(listing)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        self.enqueue(Marketplace::at(self.context.this_address())._register_listing(content_hash, price, token, category));
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
    // Moves buyer's private tokens into the contract's public balance
    // via transfer_to_public, then creates an EscrowNote for the seller.

    #[external("private")]
    fn lock_payment(
        listing_id: Field,
        seller: AztecAddress,
        amount: Field,
        token: AztecAddress,
        deadline: Field,
    ) {
        let buyer = self.msg_sender();

        // Private-to-public: buyer's private balance -> contract's public balance.
        self.call(Token::at(token).transfer_to_public(buyer, self.address, amount as u128, 0));

        let escrow = EscrowNote {
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
            "Deadline too soon -- must be at least MIN_DEADLINE_BLOCKS in the future"
        );
    }

    // ---------------------------------------------------------------
    // Deliver and Claim (Seller)
    // ---------------------------------------------------------------
    // Consumes the ListingNote and EscrowNote, creates a DataNote for
    // the buyer, and enqueues a public transfer to release payment.

    #[external("private")]
    fn deliver_and_claim(
        listing_id: Field,
        buyer: AztecAddress,
        data_0: Field,
        data_1: Field,
        data_2: Field,
        data_3: Field,
    ) {
        let seller = self.msg_sender();

        let computed_hash = hash_args([data_0, data_1, data_2, data_3]);

        let listing_options = NoteGetterOptions::<ListingNote, 2, Field, Field>::new()
            .select(ListingNote::properties().content_hash, Comparator.EQ, computed_hash)
            .set_limit(1);

        let listing_notes = self.storage.listing_notes.at(seller).pop_notes(listing_options);
        assert(listing_notes.len() == 1, "No matching listing note found");

        let committed_hash = listing_notes.get(0).content_hash;

        let escrow_options = NoteGetterOptions::<EscrowNote, 5, Field, Field>::new()
            .select(EscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(EscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let escrow_notes = self.storage.escrows.at(seller).pop_notes(escrow_options);
        assert(escrow_notes.len() == 1, "No matching escrow note found");

        let escrow = escrow_notes.get(0);

        let data = DataNote {
            listing_id,
            content_hash: committed_hash,
            data_0,
            data_1,
            data_2,
            data_3,
        };

        self.storage.data_notes.at(buyer)
            .insert(data)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        // Public transfer: contract's public balance -> seller's public balance.
        self.enqueue(Token::at(escrow.token).transfer_in_public(self.context.this_address(), seller, escrow.amount as u128, 0));

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
    // Consumes the EscrowNote, checks the deadline has passed, and
    // enqueues a public transfer back to the buyer.

    #[external("private")]
    fn refund(listing_id: Field, seller: AztecAddress) {
        let buyer = self.msg_sender();

        let options = NoteGetterOptions::<EscrowNote, 5, Field, Field>::new()
            .select(EscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(EscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
            .set_limit(1);

        let notes = self.storage.escrows.at(seller).pop_notes(options);
        assert(notes.len() == 1, "No matching escrow note found for refund");

        let escrow = notes.get(0);

        self.enqueue_self._check_deadline(escrow.deadline);

        // Public transfer: contract's public balance -> buyer's public balance.
        self.enqueue(Token::at(escrow.token).transfer_in_public(self.context.this_address(), buyer, escrow.amount as u128, 0));
    }

    #[external("public")]
    #[only_self]
    fn _check_deadline(deadline: Field) {
        let current_block = self.context.block_number();
        assert(current_block >= deadline as u32, "Deadline has not passed -- refund not yet available");
    }

    // ---------------------------------------------------------------
    // Utility
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