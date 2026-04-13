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

// NOTE: SELLER_ADDRESS removed — now tracked in context's listingSellers map

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

export const DOM_SEP_FUNCTION_ARGS = 3576554347;

export const P256_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);
export const P256_HALF_ORDER = P256_ORDER / 2n;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<string, string> = {
  "1": "Health / Wearable",
  "2": "Financial",
  "3": "Demographic",
};

export const DEVICE_LABELS: Record<string, string> = {
  "1": "Apple Watch",
  "2": "Garmin",
  "3": "Oura Ring",
  "4": "Fitbit",
};

export const ATTESTOR_LABELS: Record<string, string> = {
  "1": "App Attest",
  "2": "TLS Notary",
  "3": "Direct Signature",
};