/**
 * Encode/decode a short listing name (up to 31 UTF-8 bytes) as a single Field.
 *
 * A BN254 Field is ~254 bits, so 31 bytes fit safely with 2 bits headroom.
 * Longer input is truncated at 31 bytes. If truncation would fall in the
 * middle of a multi-byte UTF-8 sequence, we back off to the last complete
 * character so the decoded string is always valid UTF-8.
 */

import { Fr } from "@aztec/aztec.js/fields";

const MAX_NAME_BYTES = 31;

/** Encode a string to a single Field, big-endian bytes. */
export function nameToField(name: string): Fr {
  if (!name) return new Fr(0n);

  const encoder = new TextEncoder();
  let bytes = encoder.encode(name);

  if (bytes.length > MAX_NAME_BYTES) {
    // Truncate, then back off to the last complete UTF-8 codepoint boundary.
    let cut = MAX_NAME_BYTES;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
      cut--;
    }
    bytes = bytes.slice(0, cut);
  }

  // Pack bytes as big-endian BigInt
  let value = 0n;
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b);
  }
  return new Fr(value);
}

/** Decode a Field back to its string representation. */
export function fieldToName(value: bigint): string {
  if (value === 0n) return "";

  // Extract bytes big-endian
  const bytes: number[] = [];
  let v = value;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }

  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}