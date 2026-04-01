// Attestor Registry Contract
//
// Stores recognised attestors (data sources) that the marketplace
// trusts for data provenance. Each attestor has a public key and
// a type (e.g. app-attest, tls-notary, direct-signature).
//
// Admin-gated: only the admin can register or deactivate attestors.
// The marketplace contract reads from this registry at listing time
// to verify that data carries a valid attestation.

use aztec::macros::aztec;

#[aztec]
pub contract AttestorRegistry {
    use aztec::{
        macros::{
            functions::{external, initializer, view},
            storage::storage,
        },
        protocol::{
            address::AztecAddress,
            traits::Packable,
        },
        state_vars::{Map, PublicMutable},
    };

    // Attestor types
    global ATTESTOR_TYPE_APP_ATTEST: Field = 1;
    global ATTESTOR_TYPE_TLS_NOTARY: Field = 2;
    global ATTESTOR_TYPE_DIRECT_SIGNATURE: Field = 3;

    #[derive(Packable)]
    pub struct AttestorEntry {
        // The attestor's public key (x coordinate).
        // For ECDSA P-256 (App Attest), this is the x component.
        pub key_x: Field,
        // The attestor's public key (y coordinate).
        pub key_y: Field,
        // Attestor type: 1 = app-attest, 2 = tls-notary, 3 = direct-signature
        pub attestor_type: Field,
        // Whether this attestor is currently active.
        pub active: bool,
    }

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        // Map from attestor_id (Field) to AttestorEntry
        attestors: Map<Field, PublicMutable<AttestorEntry, Context>, Context>,
        next_attestor_id: PublicMutable<Field, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        assert(!admin.is_zero(), "invalid admin");
        self.storage.admin.write(admin);
        self.storage.next_attestor_id.write(1);
    }

    // ---------------------------------------------------------------
    // Register Attestor (Admin only)
    // ---------------------------------------------------------------

    #[external("public")]
    fn register_attestor(
        key_x: Field,
        key_y: Field,
        attestor_type: Field,
    ) {
        let caller = self.msg_sender();
        assert(caller.eq(self.storage.admin.read()), "caller is not admin");

        assert(
            (attestor_type == ATTESTOR_TYPE_APP_ATTEST)
            | (attestor_type == ATTESTOR_TYPE_TLS_NOTARY)
            | (attestor_type == ATTESTOR_TYPE_DIRECT_SIGNATURE),
            "invalid attestor type"
        );

        let attestor_id = self.storage.next_attestor_id.read();
        self.storage.next_attestor_id.write(attestor_id + 1);

        let entry = AttestorEntry {
            key_x,
            key_y,
            attestor_type,
            active: true,
        };
        self.storage.attestors.at(attestor_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Deactivate Attestor (Admin only)
    // ---------------------------------------------------------------

    #[external("public")]
    fn deactivate_attestor(attestor_id: Field) {
        let caller = self.msg_sender();
        assert(caller.eq(self.storage.admin.read()), "caller is not admin");

        let mut entry = self.storage.attestors.at(attestor_id).read();
        assert(entry.active, "attestor is already inactive");

        entry.active = false;
        self.storage.attestors.at(attestor_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Reactivate Attestor (Admin only)
    // ---------------------------------------------------------------

    #[external("public")]
    fn reactivate_attestor(attestor_id: Field) {
        let caller = self.msg_sender();
        assert(caller.eq(self.storage.admin.read()), "caller is not admin");

        let mut entry = self.storage.attestors.at(attestor_id).read();
        assert(!entry.active, "attestor is already active");

        entry.active = true;
        self.storage.attestors.at(attestor_id).write(entry);
    }

    // ---------------------------------------------------------------
    // Public check (callable by other contracts)
    // ---------------------------------------------------------------
    // Used by the Marketplace to verify an attestor is registered
    // and active. Called via enqueue_view from a private function.
    // Reverts if the attestor is not active.

    #[external("public")]
    #[view]
    fn assert_attestor_active(attestor_id: Field) {
        let entry = self.storage.attestors.at(attestor_id).read();
        assert(entry.active, "attestor is not registered or not active");
    }

    // ---------------------------------------------------------------
    // Admin management
    // ---------------------------------------------------------------

    #[external("public")]
    fn set_admin(new_admin: AztecAddress) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "caller is not admin");
        assert(!new_admin.is_zero(), "invalid admin");
        self.storage.admin.write(new_admin);
    }

    // ---------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------

    #[external("utility")]
    unconstrained fn get_attestor(attestor_id: Field) -> pub AttestorEntry {
        self.storage.attestors.at(attestor_id).read()
    }

    #[external("utility")]
    unconstrained fn get_next_attestor_id() -> pub Field {
        self.storage.next_attestor_id.read()
    }

    #[external("utility")]
    unconstrained fn get_admin() -> pub AztecAddress {
        self.storage.admin.read()
    }
}