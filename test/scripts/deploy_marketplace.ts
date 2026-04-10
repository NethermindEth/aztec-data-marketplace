/**
 * Deploy script for the Data Marketplace
 *
 * Deploys:
 * 1. Attestor Registry (with a test P-256 attestor registered)
 * 2. Marketplace contract (pointed at the registry)
 * 3. Token contract (test stablecoin for payments)
 *
 * Outputs all addresses and the test attestor key pair to .env.marketplace
 * The web client reads these on startup.
 *
 * Usage:
 *   AZTEC_NODE_URL=http://localhost:8080 npm run deploy:marketplace
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { Fr } from "@aztec/aztec.js/fields";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { MarketplaceContract } from "../artifacts/Marketplace.js";
import { AttestorRegistryContract } from "../artifacts/AttestorRegistry.js";
import * as crypto from "crypto";
import * as fs from "fs";

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const nodeUrl = process.env.AZTEC_NODE_URL;
if (!nodeUrl) {
  console.error("Error: AZTEC_NODE_URL environment variable is required");
  console.error("Usage: AZTEC_NODE_URL=http://localhost:8080 npm run deploy:marketplace");
  process.exit(1);
}
const NODE_URL: string = nodeUrl;

const DEPLOY_TIMEOUT = 120_000;
const TX_TIMEOUT = 60_000;
const ATTESTOR_TYPE_APP_ATTEST = new Fr(1n);

// ---------------------------------------------------------------
// P-256 key helpers (same as test file)
// ---------------------------------------------------------------

function generateP256KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const rawPubKey = publicKey.export({ type: "spki", format: "der" });
  const offset = rawPubKey.length - 65;
  const publicKeyX = rawPubKey.subarray(offset + 1, offset + 33);
  const publicKeyY = rawPubKey.subarray(offset + 33, offset + 65);
  return { publicKeyX, publicKeyY, privateKey };
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

// ---------------------------------------------------------------
// Sponsored FPC setup
// ---------------------------------------------------------------

async function getSponsoredFPCInstance() {
  return await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
}

// ---------------------------------------------------------------
// Main deploy
// ---------------------------------------------------------------

async function main() {
  console.log("=== Data Marketplace Deployment ===\n");
  console.log(`Node URL: ${NODE_URL}\n`);

  // 1. Connect to node and set up wallet
  console.log("1. Setting up wallet...");
  const node = createAztecNodeClient(NODE_URL);
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

  // 2. Set up sponsored fee payment
  console.log("2. Setting up sponsored fee payment...");
  const sponsoredFPC = await getSponsoredFPCInstance();
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  // 3. Deploy admin account (same pattern as marketplace test beforeAll)
  console.log("3. Deploying admin account...");
  const adminSecret = Fr.random();
  const adminSalt = Fr.random();
  const adminSigningKey = GrumpkinScalar.random();
  const adminAccount = await wallet.createSchnorrAccount(adminSecret, adminSalt, adminSigningKey);

  await (await adminAccount.getDeployMethod()).send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
    wait: { timeout: DEPLOY_TIMEOUT },
  });
  console.log(`   Admin account: ${adminAccount.address}`);

  // 4. Generate test attestor P-256 key pair
  console.log("4. Generating test attestor P-256 key pair...");
  const p256KeyPair = generateP256KeyPair();
  const keyHash = await computeKeyHash(p256KeyPair.publicKeyX, p256KeyPair.publicKeyY);
  console.log(`   Key hash: ${keyHash.toString()}`);

  // 5. Deploy Attestor Registry
  console.log("5. Deploying Attestor Registry...");
  const registryDeploy = AttestorRegistryContract.deploy(wallet, adminAccount.address);
  await registryDeploy.simulate({ from: adminAccount.address });
  const { contract: registry } = await registryDeploy.send({
    from: adminAccount.address,
    fee: { paymentMethod },
    wait: { timeout: DEPLOY_TIMEOUT },
  });
  console.log(`   Registry: ${registry.address}`);

  // 6. Register the test attestor
  console.log("6. Registering test attestor...");
  await registry.methods
    .register_attestor(keyHash, ATTESTOR_TYPE_APP_ATTEST)
    .simulate({ from: adminAccount.address });
  await registry.methods
    .register_attestor(keyHash, ATTESTOR_TYPE_APP_ATTEST)
    .send({
      from: adminAccount.address,
      fee: { paymentMethod },
      wait: { timeout: TX_TIMEOUT },
    });
  console.log("   Attestor registered with ID 1");

  // 7. Deploy Marketplace
  console.log("7. Deploying Marketplace...");
  const marketplaceDeploy = MarketplaceContract.deploy(
    wallet,
    adminAccount.address,
    registry.address
  );
  await marketplaceDeploy.simulate({ from: adminAccount.address });
  const { contract: marketplace } = await marketplaceDeploy.send({
    from: adminAccount.address,
    fee: { paymentMethod },
    wait: { timeout: DEPLOY_TIMEOUT },
  });
  console.log(`   Marketplace: ${marketplace.address}`);

  // 8. Deploy test token (stablecoin)
  console.log("8. Deploying test token...");
  const tokenDeploy = TokenContract.deploy(
    wallet,
    adminAccount.address,
    "Test USDC",
    "USDC",
    6
  );
  await tokenDeploy.simulate({ from: adminAccount.address });
  const { contract: token } = await tokenDeploy.send({
    from: adminAccount.address,
    fee: { paymentMethod },
    wait: { timeout: DEPLOY_TIMEOUT },
  });
  console.log(`   Token: ${token.address}`);

  // 9. Write addresses to .env.marketplace
  console.log("\n9. Writing config to .env.marketplace...");
  const envContent = [
    "# Data Marketplace deployment config",
    `# Generated at ${new Date().toISOString()}`,
    "",
    "# Contract addresses",
    `MARKETPLACE_ADDRESS=${marketplace.address}`,
    `REGISTRY_ADDRESS=${registry.address}`,
    `TOKEN_ADDRESS=${token.address}`,
    "",
    "# Admin account (used for deploy only)",
    `ADMIN_ADDRESS=${adminAccount.address}`,
    `ADMIN_SECRET=${adminSecret.toString()}`,
    `ADMIN_SALT=${adminSalt.toString()}`,
    `ADMIN_SIGNING_KEY=${adminSigningKey.toString()}`,
    "",
    "# Test attestor (P-256)",
    `ATTESTOR_ID=1`,
    `ATTESTOR_KEY_HASH=${keyHash.toString()}`,
    `ATTESTOR_PUBLIC_KEY_X=${p256KeyPair.publicKeyX.toString("hex")}`,
    `ATTESTOR_PUBLIC_KEY_Y=${p256KeyPair.publicKeyY.toString("hex")}`,
    `ATTESTOR_PRIVATE_KEY=${p256KeyPair.privateKey.export({ type: "pkcs8", format: "pem" })}`,
    "",
    "# Network",
    `AZTEC_NODE_URL=${NODE_URL}`,
  ].join("\n");

  fs.writeFileSync(".env.marketplace", envContent);
  console.log("   Saved to .env.marketplace");

  // 10. Summary
  console.log("\n=== Deployment Complete ===\n");
  console.log("Contract addresses:");
  console.log(`  Marketplace:  ${marketplace.address}`);
  console.log(`  Registry:     ${registry.address}`);
  console.log(`  Token (USDC): ${token.address}`);
  console.log(`  Admin:        ${adminAccount.address}`);
  console.log(`\nTest attestor ID: 1`);
  console.log(`\nConfig written to .env.marketplace`);
  console.log("The web client will read these addresses on startup.\n");

  await wallet.stop();
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});