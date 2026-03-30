// ListingNote: created when the seller lists data.
// Commits the content_hash so the seller cannot change it after listing.
// The seller nullifies this note during delivery, binding the delivered
// data to the original commitment.
//
// Stored in a PrivateSet owned by the seller.

use aztec::macros::notes::note;
use aztec::protocol::traits::Packable;

#[derive(Eq, Packable)]
#[note]
pub struct ListingNote {
    // The listing ID (matches the public index entry)
    pub listing_id: Field,
    // Content hash committed at listing time.
    // hash(data_0, data_1, data_2, data_3)
    pub content_hash: Field,
}