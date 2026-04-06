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

const NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const DEPLOY_TIMEOUT = 120_000;
const TX_TIMEOUT = 60_000;

const logger = createLogger("e2e:marketplace");

// Health data: heart rate 68 bpm, timestamp, source device 1 (Apple Watch), reserved
const DATA_0 = new Fr(68n);     // measurement value
const DATA_1 = new Fr(1710000000n); // timestamp
const DATA_2 = new Fr(1n);      // source device type (1 = Apple Watch)
const DATA_3 = new Fr(0n);      // reserved

const BAD_DATA_0 = new Fr(999n);  // out of range heart rate
const BAD_DATA_1 = new Fr(68n);   // wrong data for delivery test

const CATEGORY = new Fr(1n);
const PRICE = new Fr(100n);
const PRICE_2 = new Fr(200n);
const PRICE_3 = new Fr(300n);
const PRICE_4 = new Fr(400n);

// Property proof parameters
const VALUE_MIN = new Fr(40n);   // min valid heart rate
const VALUE_MAX = new Fr(200n);  // max valid heart rate
const DEVICE_ID = new Fr(1n);    // Apple Watch

// Test attestor
const ATTESTOR_KEY_X = new Fr(12345n);
const ATTESTOR_KEY_Y = new Fr(67890n);
const ATTESTOR_TYPE_APP_ATTEST = new Fr(1n);

async function getSponsoredFPCInstance() {
  return await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
}

describe("Data Marketplace E2E", () => {
  let wallet: EmbeddedWallet;
  let sponsoredPaymentMethod: SponsoredFeePaymentMethod;
  let sellerAccount: AccountManager;
  let buyerAccount: AccountManager;
  let token: TokenContract;
  let marketplace: MarketplaceContract;
  let registry: AttestorRegistryContract;
  let attestorId: Fr;

  beforeAll(async () => {
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

    // Mint and transfer tokens to buyer's private balance
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

    // Register a test attestor
    await registry.methods.register_attestor(ATTESTOR_KEY_X, ATTESTOR_KEY_Y, ATTESTOR_TYPE_APP_ATTEST)
      .simulate({ from: sellerAccount.address });
    await registry.methods.register_attestor(ATTESTOR_KEY_X, ATTESTOR_KEY_Y, ATTESTOR_TYPE_APP_ATTEST)
      .send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });
    attestorId = new Fr(1n);
    logger.info("Test attestor registered");

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

  it("happy path: list with proofs, lock payment, deliver and claim", async () => {
    // create_listing now takes raw data + proof params, computes content hash internally
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE, token.address, CATEGORY,
      VALUE_MIN, VALUE_MAX, DEVICE_ID,
      attestorId, registry.address
    ).simulate({ from: sellerAccount.address });
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE, token.address, CATEGORY,
      VALUE_MIN, VALUE_MAX, DEVICE_ID,
      attestorId, registry.address
    ).send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });

    const listingId = new Fr(1n);
    const listing = await marketplace.methods.get_listing(listingId).simulate({ from: sellerAccount.address });
    expect(listing.result.active).toBe(true);
    expect(BigInt(listing.result.attestor_id)).toBe(1n);
    expect(BigInt(listing.result.value_min)).toBe(40n);
    expect(BigInt(listing.result.value_max)).toBe(200n);
    expect(BigInt(listing.result.device_id)).toBe(1n);

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
    logger.info("Payment locked");

    await marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, DATA_0, DATA_1, DATA_2, DATA_3)
      .simulate({ from: sellerAccount.address });
    await marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, DATA_0, DATA_1, DATA_2, DATA_3)
      .send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });
    logger.info("Delivered and claimed");

    const listingAfter = await marketplace.methods.get_listing(listingId).simulate({ from: sellerAccount.address });
    expect(listingAfter.result.active).toBe(false);
  }, 600_000);

  it("should reject delivery of wrong data", async () => {
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE_2, token.address, CATEGORY,
      VALUE_MIN, VALUE_MAX, DEVICE_ID,
      attestorId, registry.address
    ).simulate({ from: sellerAccount.address });
    await marketplace.methods.create_listing(
      DATA_0, DATA_1, DATA_2, DATA_3,
      PRICE_2, token.address, CATEGORY,
      VALUE_MIN, VALUE_MAX, DEVICE_ID,
      attestorId, registry.address
    ).send({
      from: sellerAccount.address,
      fee: { paymentMethod: sponsoredPaymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });

    const nextId = await marketplace.methods.get_next_listing_id().simulate({ from: sellerAccount.address });
    const listingId = new Fr(BigInt(nextId.result) - 1n);

    const lockAction = token.methods.transfer_to_public(buyerAccount.address, marketplace.address, 200n, 0);
    const authWit = await wallet.createAuthWit(buyerAccount.address, { caller: marketplace.address, action: lockAction });
    const deadline = new Fr(1200n);

    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE_2, token.address, deadline)
      .with({ authWitnesses: [authWit] })
      .simulate({ from: buyerAccount.address });
    await marketplace.methods.lock_payment(listingId, sellerAccount.address, PRICE_2, token.address, deadline)
      .with({ authWitnesses: [authWit] })
      .send({
        from: buyerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      });

    await expect(
      marketplace.methods.deliver_and_claim(listingId, buyerAccount.address, BAD_DATA_0, DATA_1, DATA_2, DATA_3)
        .send({
          from: sellerAccount.address,
          fee: { paymentMethod: sponsoredPaymentMethod },
          wait: { timeout: TX_TIMEOUT },
        })
    ).rejects.toThrow();

    logger.info("Wrong data rejection test passed");
  }, 600_000);

  it("should reject listing with invalid attestor", async () => {
    const fakeAttestorId = new Fr(999n);

    await expect(
      marketplace.methods.create_listing(
        DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_3, token.address, CATEGORY,
        VALUE_MIN, VALUE_MAX, DEVICE_ID,
        fakeAttestorId, registry.address
      ).send({
        from: sellerAccount.address,
        fee: { paymentMethod: sponsoredPaymentMethod },
        wait: { timeout: TX_TIMEOUT },
      })
    ).rejects.toThrow();

    logger.info("Invalid attestor rejection test passed");
  }, 600_000);

  it("should reject listing with value out of range", async () => {
    // DATA with heart rate of 999, outside the 40-200 range
    await expect(
      marketplace.methods.create_listing(
        BAD_DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_3, token.address, CATEGORY,
        VALUE_MIN, VALUE_MAX, DEVICE_ID,
        attestorId, registry.address
      ).simulate({ from: sellerAccount.address })
    ).rejects.toThrow();

    logger.info("Value out of range rejection test passed");
  }, 600_000);

  it("should reject listing with wrong device ID", async () => {
    const wrongDeviceId = new Fr(99n);

    await expect(
      marketplace.methods.create_listing(
        DATA_0, DATA_1, DATA_2, DATA_3,
        PRICE_4, token.address, CATEGORY,
        VALUE_MIN, VALUE_MAX, wrongDeviceId,
        attestorId, registry.address
      ).simulate({ from: sellerAccount.address })
    ).rejects.toThrow();

    logger.info("Wrong device ID rejection test passed");
  }, 600_000);
});