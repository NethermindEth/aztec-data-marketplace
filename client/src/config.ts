import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const AZTEC_NODE_URL =
  import.meta.env.VITE_AZTEC_NODE_URL ?? "http://localhost:8080";

// ---------------------------------------------------------------------------
// Contract addresses (populated after deploy)
// ---------------------------------------------------------------------------

function addr(envVar: string): AztecAddress {
  const raw = import.meta.env[envVar];
  if (!raw) throw new Error(`Missing env var: ${envVar}`);
  return AztecAddress.fromString(raw);
}

export const MARKETPLACE_ADDRESS = () => addr("VITE_MARKETPLACE_ADDRESS");
export const REGISTRY_ADDRESS = () => addr("VITE_REGISTRY_ADDRESS");
export const TOKEN_ADDRESS = () => addr("VITE_TOKEN_ADDRESS");
export const ADMIN_ADDRESS = () => addr("VITE_ADMIN_ADDRESS");

/**
 * Seller address — MVP demo shortcut for a single known seller.
 *
 * TODO (production): seller address should be passed via the off-chain relay,
 * not hardcoded. The same relay needed for deliver_and_claim note discovery
 * will solve this by passing the seller address to buyers at purchase time.
 * Adding the seller address to the public ListingEntry was rejected because
 * it would break seller privacy for every listing, permanently, on an
 * immutable chain.
 */
export const SELLER_ADDRESS = () => addr("VITE_SELLER_ADDRESS");

// ---------------------------------------------------------------------------
// Admin account keys (for minting test tokens)
// ---------------------------------------------------------------------------

export const ADMIN_SECRET = () =>
  Fr.fromHexString(import.meta.env.VITE_ADMIN_SECRET ?? "0x0");
export const ADMIN_SALT = () =>
  Fr.fromHexString(import.meta.env.VITE_ADMIN_SALT ?? "0x0");
export const ADMIN_SIGNING_KEY = () =>
  import.meta.env.VITE_ADMIN_SIGNING_KEY ?? "";

// ---------------------------------------------------------------------------
// Attestor config
// ---------------------------------------------------------------------------

export const ATTESTOR_ID = new Fr(
  BigInt(import.meta.env.VITE_ATTESTOR_ID ?? "1"),
);

export const ATTESTOR_PUBLIC_KEY_X = (): string =>
  import.meta.env.VITE_ATTESTOR_PUBLIC_KEY_X ?? "";
export const ATTESTOR_PUBLIC_KEY_Y = (): string =>
  import.meta.env.VITE_ATTESTOR_PUBLIC_KEY_Y ?? "";
export const ATTESTOR_PRIVATE_KEY = (): string =>
  import.meta.env.VITE_ATTESTOR_PRIVATE_KEY ?? "";

// ---------------------------------------------------------------------------
// Crypto constants (must match contract and test file)
// ---------------------------------------------------------------------------

/** Poseidon2 domain separator used by hash_args in the marketplace contract. */
export const DOM_SEP_FUNCTION_ARGS = 3576554347;

/** P-256 curve order — for low-s normalisation. */
export const P256_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);
export const P256_HALF_ORDER = P256_ORDER / 2n;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Map category Field values to human-readable labels. */
export const CATEGORY_LABELS: Record<string, string> = {
  "1": "Health / Wearable",
  "2": "Financial",
  "3": "Demographic",
};

/** Map device_id Field values to human-readable labels. */
export const DEVICE_LABELS: Record<string, string> = {
  "1": "Apple Watch",
  "2": "Garmin",
  "3": "Oura Ring",
  "4": "Fitbit",
};

/** Map attestor_id Field values to attestation type labels. */
export const ATTESTOR_LABELS: Record<string, string> = {
  "1": "App Attest",
  "2": "TLS Notary",
  "3": "Direct Signature",
};