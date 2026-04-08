// Data Marketplace Contract - Phase 2 (attestation + property proofs + ECDSA verification)

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
    use aztec::protocol::hash::poseidon2_hash_with_separator;
    use crate::escrow_note::EscrowNote;
    use crate::data_note::DataNote;
    use crate::listing_note::ListingNote;
    use token::Token;
    use attestor_registry::AttestorRegistry;

    global MIN_DEADLINE_BLOCKS: u32 = 100;

    #[derive(Packable)]
    pub struct ListingEntry {
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
        attestor_id: Field,
        value_min: Field,
        value_max: Field,
        device_id: Field,
        active: bool,
    }

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        registry: PublicMutable<AztecAddress, Context>,
        listings: Map<Field, PublicMutable<ListingEntry, Context>, Context>,
        next_listing_id: PublicMutable<Field, Context>,
        listing_notes: Owned<PrivateSet<ListingNote, Context>, Context>,
        escrows: Owned<PrivateSet<EscrowNote, Context>, Context>,
        data_notes: Owned<PrivateSet<DataNote, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, registry: AztecAddress) {
        assert(!admin.is_zero(), "invalid admin");
        assert(!registry.is_zero(), "invalid registry address");
        self.storage.admin.write(admin);
        self.storage.registry.write(registry);
        self.storage.next_listing_id.write(1);
    }

    // ---------------------------------------------------------------
    // Create Listing (Seller)
    // ---------------------------------------------------------------

    #[external("private")]
    fn create_listing(
        data_0: Field,
        data_1: Field,
        data_2: Field,
        data_3: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
        value_min: Field,
        value_max: Field,
        device_id: Field,
        attestor_id: Field,
        registry_address: AztecAddress,
        signature: [Field; 64],
        pub_key_x: [Field; 32],
        pub_key_y: [Field; 32],
    ) {
        let seller = self.msg_sender();

        let content_hash = hash_args([data_0, data_1, data_2, data_3]);

        _verify_attestation(content_hash, signature, pub_key_x, pub_key_y);

        _verify_data_properties(data_0, data_2, value_min, value_max, device_id);

        let key_hash = _compute_key_hash(pub_key_x, pub_key_y);

        let listing = ListingNote {
            listing_id: 0,
            content_hash,
        };
        self.storage.listing_notes.at(seller)
            .insert(listing)
            .deliver(MessageDelivery.ONCHAIN_UNCONSTRAINED);

        AttestorRegistry::at(registry_address)
            .assert_attestor_key(attestor_id, key_hash)
            .enqueue_view_incognito(self.context);

        self.enqueue_self._register_listing(
            content_hash, price, token, category, attestor_id,
            value_min, value_max, device_id, registry_address
        );
    }

    // ---------------------------------------------------------------
    // ECDSA Attestation Verification (internal)
    // ---------------------------------------------------------------
    // Signing flow:
    //   TypeScript: crypto.sign(null, content_hash_bytes, key)
    //     -> Node internally computes SHA256(content_hash_bytes) as the ECDSA scalar
    //   Noir: hashed_message = sha256::digest(content_hash.to_be_bytes())
    //     -> verify_signature uses hashed_message directly as the ECDSA scalar
    //   Both sides: scalar = SHA256(content_hash_bytes). Match.
    //
    // The signature s value must be low-s normalized (s <= order/2).

    #[contract_library_method]
    fn _verify_attestation(
        content_hash: Field,
        signature: [Field; 64],
        pub_key_x: [Field; 32],
        pub_key_y: [Field; 32],
    ) {
        // Convert content hash to 32 big-endian bytes
        let msg_bytes: [u8; 32] = content_hash.to_be_bytes();

        // SHA256 to produce the same scalar that Node.js crypto.sign(null, ...) uses
        let hashed_message: [u8; 32] = sha256::digest(msg_bytes);

        // Cast signature Fields to bytes
        let mut sig_bytes: [u8; 64] = [0; 64];
        for i in 0..64 {
            sig_bytes[i] = signature[i] as u8;
        }

        // Cast public key Fields to bytes
        let mut pk_x_bytes: [u8; 32] = [0; 32];
        let mut pk_y_bytes: [u8; 32] = [0; 32];
        for i in 0..32 {
            pk_x_bytes[i] = pub_key_x[i] as u8;
            pk_y_bytes[i] = pub_key_y[i] as u8;
        }

        // Verify the ECDSA P-256 signature
        let valid = std::ecdsa_secp256r1::verify_signature(
            pk_x_bytes,
            pk_y_bytes,
            sig_bytes,
            hashed_message,
        );
        assert(valid, "ECDSA signature verification failed");
    }

    // ---------------------------------------------------------------
    // Key Hash Computation (internal)
    // ---------------------------------------------------------------

    #[contract_library_method]
    fn _compute_key_hash(
        pub_key_x: [Field; 32],
        pub_key_y: [Field; 32],
    ) -> Field {
        let mut key_fields: [Field; 64] = [0; 64];
        for i in 0..32 {
            key_fields[i] = pub_key_x[i];
            key_fields[i + 32] = pub_key_y[i];
        }
        // Separator 0 - must match TypeScript: poseidon2HashWithSeparator(keyFields, 0)
        poseidon2_hash_with_separator(key_fields, 0)
    }

    // ---------------------------------------------------------------
    // Data Property Verification (internal)
    // ---------------------------------------------------------------

    #[contract_library_method]
    fn _verify_data_properties(
        data_0: Field,
        data_2: Field,
        value_min: Field,
        value_max: Field,
        device_id: Field,
    ) {
        assert(value_min as u64 <= data_0 as u64, "data_0 is below value_min");
        assert(data_0 as u64 <= value_max as u64, "data_0 is above value_max");
        assert(data_2 == device_id, "data_2 does not match claimed device_id");
    }

    // ---------------------------------------------------------------
    // Register Listing (public, self-only)
    // ---------------------------------------------------------------

    #[external("public")]
    #[only_self]
    fn _register_listing(
        content_hash: Field,
        price: Field,
        token: AztecAddress,
        category: Field,
        attestor_id: Field,
        value_min: Field,
        value_max: Field,
        device_id: Field,
        registry_address: AztecAddress,
    ) {
        let stored_registry = self.storage.registry.read();
        assert(
            registry_address.eq(stored_registry),
            "registry address does not match stored registry"
        );

        let listing_id = self.storage.next_listing_id.read();
        self.storage.next_listing_id.write(listing_id + 1);

        let entry = ListingEntry {
            content_hash,
            price,
            token,
            category,
            attestor_id,
            value_min,
            value_max,
            device_id,
            active: true,
        };
        self.storage.listings.at(listing_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Admin: Set Registry
    // ---------------------------------------------------------------

    #[external("public")]
    fn set_registry(registry: AztecAddress) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "caller is not admin");
        assert(!registry.is_zero(), "invalid registry address");
        self.storage.registry.write(registry);
    }

    // ---------------------------------------------------------------
    // Lock Payment (Buyer)
    // ---------------------------------------------------------------

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

        self.enqueue(Token::at(escrow.token).transfer_in_public(
            self.address,
            seller,
            escrow.amount as u128,
            0,
        ));

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

    #[external("private")]
    fn refund(listing_id: Field, seller: AztecAddress) {
        let buyer = self.msg_sender();

        let escrow_options = NoteGetterOptions::<EscrowNote, 5, Field, Field>::new()
            .select(EscrowNote::properties().listing_id, Comparator.EQ, listing_id)
            .select(EscrowNote::properties().buyer, Comparator.EQ, buyer.to_field())
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
            "Deadline has not passed"
        );
    }

    // ---------------------------------------------------------------
    // View functions
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