// C2DListingNote: lives in the seller's PrivateSet.
//
// Holds the dataset commitment H(D) so the seller's PXE can find it during
// delivery. Read non-consuming (`get_notes`) so the listing stays alive
// across multiple sales of the same dataset.
//
// The listing's public id (assigned in public state) is not in this note.
// Looking up the listing during delivery is done by h_d, which is what the
// seller and the contract both have access to in private context.

use aztec::protocol::traits::Packable;
use aztec::macros::notes::note;

#[derive(Eq, Packable)]
#[note]
pub struct C2DListingNote {
    // Dataset commitment, Poseidon2 over the seller's readings.
    pub h_d: Field,
}
