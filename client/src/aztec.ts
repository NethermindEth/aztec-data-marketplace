/**
 * Aztec wallet setup, account creation, and contract registration.
 *
 * This mirrors the patterns from test/e2e/marketplace.test.ts but adapted
 * for a browser environment with IndexedDB persistence (no ephemeral flag).
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { Fr } from "@aztec/aztec.js/fields";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import type { AccountManager } from "@aztec/aztec.js/account";

import { MarketplaceContract, MarketplaceContractArtifact } from "../../test/artifacts/Marketplace.js";
import { AttestorRegistryContract, AttestorRegistryContractArtifact } from "../../test/artifacts/AttestorRegistry.js";

import {
  AZTEC_NODE_URL,
  MARKETPLACE_ADDRESS,
  REGISTRY_ADDRESS,
  TOKEN_ADDRESS,
} from "./config.js";

// ---------------------------------------------------------------------------
// Singleton wallet instance
// ---------------------------------------------------------------------------

let walletInstance: EmbeddedWallet | null = null;
let paymentMethodInstance: SponsoredFeePaymentMethod | null = null;
let nodeClient: ReturnType<typeof createAztecNodeClient> | null = null;

/**
 * Initialise (or return existing) EmbeddedWallet.
 *
 * No ephemeral flag — PXE state persists to IndexedDB so accounts survive
 * page reloads.
 */
export async function getWallet(): Promise<EmbeddedWallet> {
  if (walletInstance) return walletInstance;

  console.log("[aztec] Creating node client...");
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  nodeClient = node;

  console.log("[aztec] Creating EmbeddedWallet...");
  const t0 = performance.now();
  walletInstance = await EmbeddedWallet.create(node);
  console.log(`[aztec] EmbeddedWallet created in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  console.log("[aztec] Registering sponsored FPC...");
  const t1 = performance.now();
  const sponsoredFPC = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) },
  );
  await walletInstance.registerContract(
    sponsoredFPC,
    SponsoredFPCContractArtifact,
  );
  paymentMethodInstance = new SponsoredFeePaymentMethod(sponsoredFPC.address);
  console.log(`[aztec] FPC registered in ${((performance.now() - t1) / 1000).toFixed(1)}s`);

  console.log("[aztec] Registering marketplace contracts...");
  await registerContracts(walletInstance);

  return walletInstance;
}

/** Return the sponsored fee payment method (wallet must be initialised). */
export function getPaymentMethod(): SponsoredFeePaymentMethod {
  if (!paymentMethodInstance) {
    throw new Error("Wallet not initialised — call getWallet() first");
  }
  return paymentMethodInstance;
}

// ---------------------------------------------------------------------------
// Account helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the wallet already has registered accounts.
 *
 * Returns the list of known account addresses (may be empty for a fresh
 * wallet).
 */
export async function getExistingAccounts(
  wallet: EmbeddedWallet,
): Promise<AztecAddress[]> {
  try {
    // Try the available API methods to find registered accounts
    const accounts = await wallet.getRegisteredAddresses();
    return accounts.map((a: any) => a.address ?? a);
  } catch {
    try {
      // Fallback: PXE might expose it differently
      const accounts = await (wallet as any).getAccounts();
      return accounts.map((a: any) => a.address ?? a);
    } catch {
      // No accounts found or API not available
      return [];
    }
  }
}

/**
 * Create and deploy a new Schnorr account.
 *
 * Uses random keys — in production these would be derived from a seed or
 * stored securely. For the MVP, randomness is fine because the PXE persists
 * the keys to IndexedDB.
 *
 * @param onStatus  Optional callback for UI status updates.
 * @returns         The AccountManager for the new account.
 */
export async function createAccount(
  onStatus?: (msg: string) => void,
): Promise<AccountManager> {
  const wallet = await getWallet();
  const paymentMethod = getPaymentMethod();

  onStatus?.("Generating keys...");
  const account = await wallet.createSchnorrAccount(
    Fr.random(),
    Fr.random(),
    GrumpkinScalar.random(),
  );

  onStatus?.("Deploying account contract (this may take a minute)...");
  await (
    await account.getDeployMethod()
  ).send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod },
    wait: { timeout: 120_000 },
  });

  onStatus?.("Registering contracts...");
  await registerContracts(wallet);

  return account;
}

/**
 * Resume an existing account by address.
 *
 * The wallet's PXE already has the keys in IndexedDB, so we just need to
 * register the contracts if they aren't already.
 */
export async function resumeAccount(
  wallet: EmbeddedWallet,
): Promise<void> {
  await registerContracts(wallet);
}

// ---------------------------------------------------------------------------
// Contract registration
// ---------------------------------------------------------------------------

/**
 * Register the Marketplace, AttestorRegistry, and Token contracts with the
 * wallet's PXE so it can simulate and interact with them.
 *
 * Uses the deployed addresses from .env and the generated TypeScript
 * artifacts from test/artifacts/.
 */
async function registerContracts(wallet: EmbeddedWallet): Promise<void> {
  if (!nodeClient) throw new Error("Node client not initialised");

  const marketplace = MARKETPLACE_ADDRESS();
  const registry = REGISTRY_ADDRESS();

  // Pattern from aztec-starter/scripts/multiple_wallet.ts:
  //   const instance = await node.getContract(address);
  //   await wallet.registerContract(instance, ContractArtifact);

  console.log("[aztec] Registering Marketplace at", marketplace.toString());
  try {
    const mpInstance = await nodeClient.getContract(marketplace);
    if (!mpInstance) throw new Error("Marketplace not found on node");
    await wallet.registerContract(mpInstance, MarketplaceContractArtifact);
    console.log("[aztec] Marketplace registered");
  } catch (e) {
    console.error("[aztec] Marketplace registration failed:", (e as Error).message);
  }

  console.log("[aztec] Registering AttestorRegistry at", registry.toString());
  try {
    const regInstance = await nodeClient.getContract(registry);
    if (!regInstance) throw new Error("AttestorRegistry not found on node");
    await wallet.registerContract(regInstance, AttestorRegistryContractArtifact);
    console.log("[aztec] AttestorRegistry registered");
  } catch (e) {
    console.error("[aztec] AttestorRegistry registration failed:", (e as Error).message);
  }
}