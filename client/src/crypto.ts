/**
 * Browser-compatible P-256 signing helpers for create_listing attestation.
 *
 * Ported from test/e2e/marketplace.test.ts (Node.js crypto) to Web Crypto API.
 *
 * Signing flow (must match contract's _verify_attestation):
 *   Browser:  crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, contentHashBytes)
 *     -> Web Crypto internally computes SHA256(contentHashBytes) then signs
 *   Noir:     sha256::digest(content_hash.to_be_bytes()) -> verify_signature uses it as scalar
 *   Both sides: scalar = SHA256(contentHashBytes)
 *
 * Web Crypto returns raw r||s (64 bytes) for P-256, same as ieee-p1363.
 */

import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { P256_ORDER, P256_HALF_ORDER, DOM_SEP_FUNCTION_ARGS } from "./config.js";

// ---------------------------------------------------------------------------
// Content hash (Poseidon2 with domain separator)
// ---------------------------------------------------------------------------

export async function computeContentHash(
  d0: Fr, d1: Fr, d2: Fr, d3: Fr,
): Promise<Fr> {
  return poseidon2HashWithSeparator([d0, d1, d2, d3], DOM_SEP_FUNCTION_ARGS);
}

// ---------------------------------------------------------------------------
// Fr to big-endian bytes
// ---------------------------------------------------------------------------

export function frToBeBytes(fr: Fr): Uint8Array {
  const hex = fr.toBigInt().toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Low-s normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise an ECDSA P-256 signature to low-s form.
 * If s > curve_order / 2, replace s with curve_order - s.
 * Required because Noir's verify_signature rejects high-s signatures.
 */
export function normalizeLowS(rawSig: Uint8Array): Uint8Array {
  const r = rawSig.slice(0, 32);
  const sBytes = rawSig.slice(32, 64);

  // Read s as big-endian BigInt
  let s = 0n;
  for (const b of sBytes) {
    s = (s << 8n) | BigInt(b);
  }

  if (s > P256_HALF_ORDER) {
    s = P256_ORDER - s;
  }

  // Write s back as 32 big-endian bytes
  const sHex = s.toString(16).padStart(64, "0");
  const normalizedS = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    normalizedS[i] = parseInt(sHex.substring(i * 2, i * 2 + 2), 16);
  }

  const result = new Uint8Array(64);
  result.set(r, 0);
  result.set(normalizedS, 32);
  return result;
}

// ---------------------------------------------------------------------------
// Import P-256 private key from PEM (PKCS#8)
// ---------------------------------------------------------------------------

/**
 * Import a PEM-encoded PKCS#8 P-256 private key into Web Crypto.
 * The PEM comes from .env with \n-escaped line breaks.
 */
export async function importP256PrivateKey(pem: string): Promise<CryptoKey> {
  // Restore newlines and strip PEM headers
  const pemClean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");

  // Base64 decode to DER
  const binaryStr = atob(pemClean);
  const der = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    der[i] = binaryStr.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// ---------------------------------------------------------------------------
// Sign content hash
// ---------------------------------------------------------------------------

/**
 * Sign a content hash with a P-256 private key using Web Crypto.
 *
 * Web Crypto's ECDSA with hash: "SHA-256" internally computes
 * SHA256(data) then signs, matching Node.js crypto.sign(null, data, key).
 *
 * Returns raw r||s (64 bytes) with low-s normalisation applied.
 */
export async function signContentHash(
  contentHash: Fr,
  privateKey: CryptoKey,
): Promise<Uint8Array> {
  const contentHashBytes = frToBeBytes(contentHash);

  const rawSig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      contentHashBytes,
    ),
  );

  return normalizeLowS(rawSig);
}

// ---------------------------------------------------------------------------
// Hex string to bytes
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Bytes to Field array (one Fr per byte)
// ---------------------------------------------------------------------------

export function bytesToFieldArray(bytes: Uint8Array, length: number): Fr[] {
  const fields: Fr[] = [];
  for (let i = 0; i < length; i++) {
    fields.push(new Fr(BigInt(bytes[i])));
  }
  return fields;
}