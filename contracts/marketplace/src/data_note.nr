// DataNote: created when the seller delivers data to the buyer.
// Contains the actual data payload (as field elements) and the content hash.
//
// For the POC, we store a small fixed-size data payload (4 fields).
// This maps to Tier 1: small structured data that fits in notes.
// Example: a single health metric encoded as fields.

use aztec::macros::notes::note;
use aztec::protocol::traits::Packable;

#[derive(Eq, Packable)]
#[note]
pub struct DataNote {
    // The listing this data belongs to
    pub listing_id: Field,
    // Content hash: hash of (data_0, data_1, data_2, data_3)
    // This must match the content_hash committed at listing time.
    pub content_hash: Field,
    // Data payload - 4 field elements for POC.
    // Real usage: encode health data into these fields.
    // e.g. data_0 = metric_type, data_1 = value, data_2 = timestamp, data_3 = source_id
    pub data_0: Field,
    pub data_1: Field,
    pub data_2: Field,
    pub data_3: Field,
}
