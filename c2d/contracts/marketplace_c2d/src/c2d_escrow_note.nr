// C2DEscrowNote: created when a buyer locks payment for a query against a listing.
//
// Lives in a PrivateSet owned by the seller so their PXE discovers it.
// Consumed (popped) on delivery or on refund.

use aztec::protocol::{address::AztecAddress, traits::Packable};
use aztec::macros::notes::note;

#[derive(Eq, Packable)]
#[note]
pub struct C2DEscrowNote {
    // Which listing this escrow is against.
    pub listing_id: Field,
    // The buyer who locked the payment.
    pub buyer: AztecAddress,
    // Amount locked, in token base units.
    pub amount: Field,
    // Payment token contract address.
    pub token: AztecAddress,
    // Block number after which the buyer can reclaim via refund.
    pub deadline: Field,
}
