// C2DResultNote: the query result delivered to the buyer after a successful
// proof verification.
//
// Lives in a PrivateSet owned by the buyer. Contains the raw result value.
// The buyer's PXE discovers it via standard tagging (the buyer registered
// the seller as a known sender at purchase time).

use aztec::protocol::traits::Packable;
use aztec::macros::notes::note;

#[derive(Eq, Packable)]
#[note]
pub struct C2DResultNote {
    // Which listing this result is for, so the buyer can correlate it
    // with their original purchase.
    pub listing_id: Field,
    // The result value itself, e.g. the integer average for an
    // average-over-window query. For the POC this is a single Field.
    pub result_value: Field,
}
