// EscrowNote: created when a buyer locks payment for a listing.
// Stored in a PrivateSet owned by the seller, so the seller's PXE discovers it.
//
// We use #[note] (not #[custom_note]) to get auto-derived hash and nullifier.
// The seller will nullify this note when they deliver data and claim payment.

use aztec::protocol::{address::AztecAddress, traits::Packable};
use aztec::macros::notes::note;

#[derive(Eq, Packable)]
#[note]
pub struct EscrowNote {
    // Which listing this escrow is for
    pub listing_id: Field,
    // The buyer who locked the payment
    pub buyer: AztecAddress,
    // Amount locked (in token base units)
    pub amount: Field,
    // Address of the payment token contract
    pub token: AztecAddress,
    // Block number after which the buyer can reclaim (timeout)
    pub deadline: Field,
}
