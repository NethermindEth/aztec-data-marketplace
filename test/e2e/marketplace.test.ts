import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { createLogger } from "@aztec/foundation/log";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { TxStatus } from "@aztec/stdlib/tx";
import { MarketplaceContract } from "../artifacts/Marketplace.js";
import { AttestorRegistryContract } from "../artifacts/AttestorRegistry.js";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import * as crypto from "crypto";

const NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const DEPLOY_TIMEOUT = 120_000;
const TX_TIMEOUT = 60_000;

const logger = createLogger("e2e:marketplace");

// Health data: heart rate 68 bpm, timestamp, source device 1 (Apple Watch), reserved
const DATA_0 = new Fr(68n);
const DATA_1 = new Fr(1710000000n);
const DATA_2 = new Fr(1n);
const DATA_3 = new Fr(0n);

const BAD_DATA_0 = new Fr(999n);

const CATEGORY = new Fr(1n);
const PRICE = new Fr(100n);
const PRICE_2 = new Fr(200n);
const PRICE_3 = new Fr(300n);
const PRICE_4 = new Fr(400n);
const PRICE_5 = new Fr(500n);

// Property proof parameters
const MEASUREMENT_MIN = new Fr(40n);
const MEASUREMENT_MAX = new Fr(200n);
const DEVICE_ID = new Fr(1n);

const NAME = new Fr(0n); // placeholder for tests; contract treats it as opaque public metadata

// Attestor type
const ATTESTOR_TYPE_APP_ATTEST = new Fr(1n);

// Domain separator for hash_args (must match Noir's DOM_SEP__FUNCTION_ARGS)
const DOM_SEP_FUNCTION_ARGS = 3576554347;

// P-256 curve order and half-order for low-s normalization.
// Noir's verify_signature requires s <= order/2 (low-s form).
// Node.js crypto.sign does NOT normalize, so ~50% of signatures
// would be rejected without this step.
const P256_ORDER = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551"
);
const P256_HALF_ORDER = P256_ORDER / 2n;

// ---------------------------------------------------------------
// P-256 Key and Signature Helpers
// ---------------------------------------------------------------

function generateP256KeyPair(): {
  publicKeyX: Buffer;
  publicKeyY: Buffer;
  privateKey: crypto.KeyObject;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });

  const rawPubKey = publicKey.export({ type: "spki", format: "der" });
  let offset = rawPubKey.length - 65;
  if (rawPubKey[offset] !== 0x04) {
    for (let i = rawPubKey.length - 65; i >= 0; i--) {
      if (rawPubKey[i] === 0x04 && rawPubKey.length - i === 65) {
        offset = i;
        break;
      }
    }
  }
  const publicKeyX = rawPubKey.subarray(offset + 1, offset + 33);
  const publicKeyY = rawPubKey.subarray(offset + 33, offset + 65);

  return { publicKeyX, publicKeyY, privateKey };
}

/**
 * Normalize an ieee-p1363 signature (r || s, 64 bytes) to low-s form.
 * If s > curve_order / 2, replace s with curve_order - s.
 * This is required because Noir's verify_signature rejects high-s signatures.
 */
function normalizeLowS(rawSig: Buffer): Buffer {
  const r = rawSig.subarray(0, 32);
  const sBytes = rawSig.subarray(32, 64);

  let s = BigInt("0x" + Buffer.from(sBytes).toString("hex"));

  if (s > P256_HALF_ORDER) {
    s = P256_ORDER - s;
  }

  const sHex = s.toString(16).padStart(64, "0");
  const normalizedS = Buffer.from(sHex, "hex");

  return Buffer.concat([r, normalizedS]);
}

/**
 * Sign a content hash for ECDSA P-256 attestation.
 *
 * Signing flow (both sides must produce the same ECDSA scalar):
 *   TypeScript: crypto.sign(null, content_hash_bytes, key)
 *     -> Node internally computes SHA256(content_hash_bytes) as the ECDSA scalar
 *   Noir: hashed_message = sha256::digest(content_hash.to_be_bytes())
 *     -> verify_signature uses hashed_message directly as the scalar
 *   Both sides: scalar = SHA256(content_hash_bytes)
 *
 * The signature is returned in ieee-p1363 format (raw r||s, 64 bytes)
 * with s normalized to low-s form (required by Noir).
 */
function signContentHash(
  contentHash: Fr,
  privateKey: crypto.KeyObject,
): Buffer {
  // content_hash as 32 big-endian bytes (matches content_hash.to_be_bytes() in Noir)
  const contentHashBytes = Buffer.alloc(32);
  const hexStr = contentHash.toBigInt().toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) {
    contentHashBytes[i] = parseInt(hexStr.substring(i * 2, i * 2 + 2), 16);
  }

  // crypto.sign(null, data, key) internally hashes data with SHA256 then signs.
  // Noir computes sha256::digest(content_hash.to_be_bytes()) and passes that
  // to verify_signature which uses it directly as the ECDSA scalar.
  // Both sides: scalar = SHA256(contentHashBytes).
  const rawSig = crypto.sign(null, contentHashBytes, {
    key: privateKey,
    dsaEncoding: "ieee-p1363" as any,
  });

  // Normalize to low-s (Noir requires s <= order/2)
  return normalizeLowS(rawSig);
}

function bytesToFieldArray(buf: Buffer, length: number): Fr[] {
  const fields: Fr[] = [];
  for (let i = 0; i < length; i++) {
    fields.push(new Fr(BigInt(buf[i])));
  }
  return fields;
}

async function computeKeyHash(publicKeyX: Buffer, publicKeyY: Buffer): Promise<Fr> {
  const keyFields: Fr[] = [
    ...bytesToFieldArray(publicKeyX, 32),
    ...bytesToFieldArray(publicKeyY, 32),
  ];
  return poseidon2HashWithSeparator(keyFields, 0);
}

async function computeContentHash(d0: Fr, d1: Fr, d2: Fr, d3: Fr): Promise<Fr> {
  return poseidon2HashWithSeparator([d0, d1, d2, d3], DOM_SEP_FUNCTION_ARGS);
}

async function getSponsoredFPCInstance() {
  return await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
}

// ---------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------

describe("Data Marketplace E2E", () => {
  let wallet: EmbeddedWallet;
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod;
  let sellerAccount: AccountManager;
  let buyerAccount: AccountManager;
  let token: TokenContract;
  let marketplace: MarketplaceContract;
  let registry: AttestorRegistryContract;
  let attestorId: Fr;

  // P-256 key pair for test attestor
  let p256KeyPair: {
    publicKeyX: Buffer;
    publicKeyY: Buffer;
    privateKey: crypto.KeyObject;
  };
  let keyHash: Fr;

  beforeAll(async () => {
    // Generate P-256 key pair for the test attestor
    p256KeyPair = generateP256KeyPair();
    keyHash = await computeKeyHash(p256KeyPair.publicKeyX, p256KeyPair.publicKeyY);
    logger.info("Generated P-256 key pair for test attestor");

    const node = createAztecNodeClient(NODE_URL);
    wallet = await EmbeddedWallet.create(node, { ephemeral: true });

    const sponsoredFPC = await getSponsoredFPCInstance();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
    sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

    sellerAccount = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), GrumpkinScalar.random());
    await (await sellerAccount.getDeployMethod()).send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: DEPLOY_TIMEOUT },
    });
    logger.info(`Seller deployed: ${sellerAccount.address}`);

    buyerAccount = await wallet.createSchnorrAccount(Fr.random(), Fr.random(), GrumpkinScalar.random());
    await (await buyerAccount.getDeployMethod()).send({
      from: AztecAddress.ZERO,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: DEPLOY_TIMEOUT },
    });
    logger.info(`Buyer deployed: ${buyerAccount.address}`);

    await wallet.registerSender(sellerAccount.address, "seller");
    await wallet.registerSender(buyerAccount.address, "buyer");

    // Deploy Token
    const tokenDeploy = TokenContract.deploy(wallet, sellerAccount.address, "TestToken", "TST", 18);
    await tokenDeploy.simulate({ from: sellerAccount.address });
    const { contract: token_ } = await tokenDeploy.send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: DEPLOY_TIMEOUT },
    });
    token = token_;
    logger.info(`Token deployed at ${token.address}`);

    // Mint and transfer tokens to buyer
    await token.methods.mint_to_public(buyerAccount.address, 10_000n).simulate({ from: sellerAccount.address });
    await token.methods.mint_to_public(buyerAccount.address, 10_000n).send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });

    await token.methods.transfer_to_private(buyerAccount.address, 10_000n).simulate({ from: buyerAccount.address });
    await token.methods.transfer_to_private(buyerAccount.address, 10_000n).send({
      from: buyerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });
    logger.info("Buyer has 10,000 tokens in private balance");

    // Deploy AttestorRegistry
    const registryDeploy = AttestorRegistryContract.deploy(wallet, sellerAccount.address);
    await registryDeploy.simulate({ from: sellerAccount.address });
    const { contract: registry_ } = await registryDeploy.send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: DEPLOY_TIMEOUT },
    });
    registry = registry_;
    logger.info(`AttestorRegistry deployed at ${registry.address}`);

    // Register test attestor with key hash
    await registry.methods.register_attestor(keyHash, ATTESTOR_TYPE_APP_ATTEST)
      .simulate({ from: sellerAccount.address });
    await registry.methods.register_attestor(keyHash, ATTESTOR_TYPE_APP_ATTEST)
      .send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });
    attestorId = new Fr(1n);
    logger.info("Test attestor registered with key hash");

    // Deploy Marketplace with registry address
    const marketplaceDeploy = MarketplaceContract.deploy(wallet, sellerAccount.address, registry.address);
    await marketplaceDeploy.simulate({ from: sellerAccount.address });
    const { contract: marketplace_ } = await marketplaceDeploy.send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: DEPLOY_TIMEOUT },
    });
    marketplace = marketplace_;
    logger.info(`Marketplace deployed at ${marketplace.address}`);
  }, 600_000);

  afterAll(async () => {
    await wallet?.stop();
  });

  it("happy path: list with ECDSA attestation, lock payment, deliver and claim", async () => {
    const contentHash = await computeContentHash(DATA_0, DATA_1, DATA_2, DATA_3);
    const rawSig = signContentHash(contentHash, p256KeyPair.privateKey);

    const sigFields = bytesToFieldArray(rawSig, 64);
    const pkXFields = bytesToFieldArray(p256KeyPair.publicKeyX, 32);
    const pkYFields = bytesToFieldArray(p256KeyPair.publicKeyY, 32);

    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE, token.address, CATEGORY,
      MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID,
      NAME, attestorId, registry.address,
      sigFields, pkXFields, pkYFields,
    ).simulate({ from: sellerAccount.address });
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE, token.address, CATEGORY,
      MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID, 
      NAME, attestorId, registry.address,
      sigFields, pkXFields, pkYFields,
    ).send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });

    const listingId = new Fr(1n);
    const listing = await marketplace.methods.get_listing(listingId).simulate({ from: sellerAccount.address });
    expect(listing.result.active).toBe(true);
    expect(BigInt(listing.result.attestor_id)).toBe(1n);
    expect(BigInt(listing.result.measurement_min)).toBe(40n);
    expect(BigInt(listing.result.measurement_max)).toBe(200n);
    expect(BigInt(listing.result.device_id)).toBe(1n);

    // Lock payment
    const lockAction = token.methods.transfer_to_public(buyerAccount.address, marketplace.address, 100n, 0);
    const authWit = await wallet.createAuthWit(buyerAccount.address, { caller: marketplace.address, action: lockAction });
    const deadline = new Fr(1200n);

    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE, token.address, deadline)
      .with({ authWitnesses: [authWit] })
      .simulate({ from: buyerAccount.address });
    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE, token.address, deadline)
      .with({ authWitnesses: [authWit] })
      .send({
        from: buyerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });

    // Deliver and claim
    await marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, DATA_0, DATA_1, DATA_2, DATA_3)
      .simulate({ from: sellerAccount.address });
    await marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, DATA_0, DATA_1, DATA_2, DATA_3)
      .send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });

    const updatedListing = await marketplace.methods.get_listing(listingId).simulate({ from: sellerAccount.address });
    expect(updatedListing.result.active).toBe(false);
  }, 120_000);

  it("should reject delivery of wrong data", async () => {
    const contentHash = await computeContentHash(DATA_0, DATA_1, DATA_2, DATA_3);
    const rawSig = signContentHash(contentHash, p256KeyPair.privateKey);
    const sigFields = bytesToFieldArray(rawSig, 64);
    const pkXFields = bytesToFieldArray(p256KeyPair.publicKeyX, 32);
    const pkYFields = bytesToFieldArray(p256KeyPair.publicKeyY, 32);

    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE_2, token.address, CATEGORY,
      MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID, NAME,
      attestorId, registry.address,
      sigFields, pkXFields, pkYFields,
    ).simulate({ from: sellerAccount.address });
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE_2, token.address, CATEGORY,
      MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID, NAME,
      attestorId, registry.address,
      sigFields, pkXFields, pkYFields,
    ).send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });

    const listingId = new Fr(2n);

    const lockAction2 = token.methods.transfer_to_public(buyerAccount.address, marketplace.address, 200n, 0);
    const authWit2 = await wallet.createAuthWit(buyerAccount.address, { caller: marketplace.address, action: lockAction2 });
    const deadline2 = new Fr(1200n);

    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE_2, token.address, deadline2)
      .with({ authWitnesses: [authWit2] })
      .simulate({ from: buyerAccount.address });
    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE_2, token.address, deadline2)
      .with({ authWitnesses: [authWit2] })
      .send({
        from: buyerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });

    await expect(
      marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, BAD_DATA_0, DATA_1, DATA_2, DATA_3)
        .simulate({ from: sellerAccount.address })
    ).rejects.toThrow();
  }, 120_000);

  it("should reject listing with invalid attestor", async () => {
    const contentHash = await computeContentHash(DATA_0, DATA_1, DATA_2, DATA_3);
    const rawSig = signContentHash(contentHash, p256KeyPair.privateKey);
    const sigFields = bytesToFieldArray(rawSig, 64);
    const pkXFields = bytesToFieldArray(p256KeyPair.publicKeyX, 32);
    const pkYFields = bytesToFieldArray(p256KeyPair.publicKeyY, 32);

    const invalidAttestorId = new Fr(999n);

    await expect(
      marketplace.methods.create_listing(
        DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_3, token.address, CATEGORY,
        MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID,
        invalidAttestorId, registry.address,
        sigFields, pkXFields, pkYFields,
      ).send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      })
    ).rejects.toThrow();
  }, 120_000);

  it("should reject listing with value out of range", async () => {
    const contentHash = await computeContentHash(BAD_DATA_0, DATA_1, DATA_2, DATA_3);
    const rawSig = signContentHash(contentHash, p256KeyPair.privateKey);
    const sigFields = bytesToFieldArray(rawSig, 64);
    const pkXFields = bytesToFieldArray(p256KeyPair.publicKeyX, 32);
    const pkYFields = bytesToFieldArray(p256KeyPair.publicKeyY, 32);

    await expect(
      marketplace.methods.create_listing(
        BAD_DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_4, token.address, CATEGORY,
        MEASUREMENT_MIN, MEASUREMENT_MAX, DEVICE_ID,
        attestorId, registry.address,
        sigFields, pkXFields, pkYFields,
      ).simulate({ from: sellerAccount.address })
    ).rejects.toThrow();
  }, 120_000);

  it("should reject listing with wrong device ID", async () => {
    const contentHash = await computeContentHash(DATA_0, DATA_1, DATA_2, DATA_3);
    const rawSig = signContentHash(contentHash, p256KeyPair.privateKey);
    const sigFields = bytesToFieldArray(rawSig, 64);
    const pkXFields = bytesToFieldArray(p256KeyPair.publicKeyX, 32);
    const pkYFields = bytesToFieldArray(p256KeyPair.publicKeyY, 32);

    const wrongDeviceId = new Fr(99n);

    await expect(
      marketplace.methods.create_listing(
        DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_5, token.address, CATEGORY,
        MEASUREMENT_MIN, MEASUREMENT_MAX, wrongDeviceId,
        attestorId, registry.address,
        sigFields, pkXFields, pkYFields,
      ).simulate({ from: sellerAccount.address })
    ).rejects.toThrow();
  }, 120_000);
});