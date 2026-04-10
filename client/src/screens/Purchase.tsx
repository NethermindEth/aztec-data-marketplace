/**
 * Purchase screen — buyer locks payment for a listing.
 *
 * Flow:
 * 1. Load listing details from on-chain public index
 * 2. Optionally mint test tokens (admin → buyer public, then transfer to private)
 * 3. Create auth witness for token transfer_to_public
 * 4. Call lock_payment with auth witness attached
 *
 * The seller address comes from VITE_SELLER_ADDRESS (MVP demo shortcut).
 * TODO (production): seller address passed via off-chain relay, not hardcoded.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import {
  MARKETPLACE_ADDRESS,
  TOKEN_ADDRESS,
  SELLER_ADDRESS,
  ADMIN_ADDRESS,
  ADMIN_SECRET,
  ADMIN_SALT,
  ADMIN_SIGNING_KEY,
  CATEGORY_LABELS,
  DEVICE_LABELS,
  ATTESTOR_LABELS,
} from "../config.js";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import type { ListingData } from "../components/ListingCard.js";

type Phase = "loading" | "ready" | "minting" | "purchasing" | "success" | "error";

function label(map: Record<string, string>, key: bigint, fallback: string): string {
  return map[key.toString()] ?? `${fallback} ${key}`;
}

export default function Purchase() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const { wallet, accountAddress, paymentMethod } = useAztec();

  const [phase, setPhase] = useState<Phase>("loading");
  const [listing, setListing] = useState<ListingData | null>(null);
  const [deadline, setDeadline] = useState("200");
  const [hasMinted, setHasMinted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Load listing details
  useEffect(() => {
    if (!wallet || !accountAddress || !listingId) return;
    let cancelled = false;

    async function load() {
      try {
        const marketplace = MarketplaceContract.at(MARKETPLACE_ADDRESS(), wallet!);
        const result = await marketplace.methods
          .get_listing(new Fr(BigInt(listingId!)))
          .simulate({ from: accountAddress! });

        if (cancelled) return;

        const r = result.result;
        setListing({
          id: Number(listingId),
          price: BigInt(r.price),
          category: BigInt(r.category),
          deviceId: BigInt(r.device_id),
          valueMin: BigInt(r.value_min),
          valueMax: BigInt(r.value_max),
          attestorId: BigInt(r.attestor_id),
          active: r.active,
        });
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[purchase] Failed to load listing:", err);
        setErrorMessage(err instanceof Error ? err.message : "Failed to load listing");
        setPhase("error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [wallet, accountAddress, listingId]);

  // Mint test tokens to buyer
  async function handleMint() {
    if (!wallet || !accountAddress || !paymentMethod || !listing) return;

    setPhase("minting");
    setStatusMessage("Minting test tokens to your account...");

    try {
      const tokenAddress = TOKEN_ADDRESS();
      const adminAddress = ADMIN_ADDRESS();
      const token = TokenContract.at(tokenAddress, wallet);

      // We need the admin account to mint. Create it from env keys.
      const adminSecret = ADMIN_SECRET();
      const adminSalt = ADMIN_SALT();
      const adminSigningKeyHex = ADMIN_SIGNING_KEY();
      const adminSigningKey = GrumpkinScalar.fromString(adminSigningKeyHex);
      const adminAccount = await wallet.createSchnorrAccount(adminSecret, adminSalt, adminSigningKey);

      // Extract proper address
      const rawAdminAddr = adminAccount.address as any;
      const adminAddr = rawAdminAddr?.item
        ? AztecAddress.fromString(rawAdminAddr.item.toString())
        : adminAccount.address;

      const mintAmount = listing.price + 1000n; // extra buffer

      // 1. Mint to public balance
      setStatusMessage("Minting to public balance...");
      await token.methods
        .mint_to_public(accountAddress, mintAmount)
        .simulate({ from: adminAddr });
      await token.methods
        .mint_to_public(accountAddress, mintAmount)
        .send({
          from: adminAddr,
          fee: { paymentMethod },
          wait: { timeout: 60_000 },
        });

      // 2. Transfer to private balance (lock_payment uses transfer_to_public from private)
      setStatusMessage("Transferring to private balance...");
      await token.methods
        .transfer_to_private(accountAddress, mintAmount)
        .simulate({ from: accountAddress });
      await token.methods
        .transfer_to_private(accountAddress, mintAmount)
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 60_000 },
        });

      console.log("[purchase] Minted and transferred", mintAmount.toString(), "tokens");
      setHasMinted(true);
      setPhase("ready");
    } catch (err) {
      console.error("[purchase] Mint failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to mint tokens");
      setPhase("error");
    }
  }

  // Lock payment
  async function handlePurchase() {
    if (!wallet || !accountAddress || !paymentMethod || !listing) return;

    setPhase("purchasing");
    setStatusMessage("Creating auth witness...");

    try {
      const tokenAddress = TOKEN_ADDRESS();
      const marketplaceAddress = MARKETPLACE_ADDRESS();
      const sellerAddress = SELLER_ADDRESS();
      const token = TokenContract.at(tokenAddress, wallet);

      const listingIdField = new Fr(BigInt(listing.id));
      const priceField = new Fr(listing.price);
      const deadlineField = new Fr(BigInt(deadline));

      // Create auth witness for the token transfer_to_public call
      // that lock_payment will make on behalf of the buyer
      const lockAction = token.methods.transfer_to_public(
        accountAddress,
        marketplaceAddress,
        listing.price,
        0,
      );
      const authWit = await wallet.createAuthWit(accountAddress, {
        caller: marketplaceAddress,
        action: lockAction,
      });

      // Simulate
      setStatusMessage("Simulating transaction...");
      const marketplace = MarketplaceContract.at(marketplaceAddress, wallet);

      await marketplace.methods
        .lock_payment(
          listingIdField,
          sellerAddress,
          priceField,
          tokenAddress,
          deadlineField,
        )
        .with({ authWitnesses: [authWit] })
        .simulate({ from: accountAddress });

      // Send
      setStatusMessage("Sending transaction (this may take a minute)...");
      await marketplace.methods
        .lock_payment(
          listingIdField,
          sellerAddress,
          priceField,
          tokenAddress,
          deadlineField,
        )
        .with({ authWitnesses: [authWit] })
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 120_000 },
        });

      console.log("[purchase] Payment locked successfully");
      setPhase("success");
    } catch (err) {
      console.error("[purchase] Failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to lock payment");
      setPhase("error");
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-16">
      {/* Hero */}
      <section className="mb-16">
        <h1 className="font-headline italic text-6xl font-bold tracking-tight mb-6">
          Purchase{" "}
          <span className="text-primary italic neon-glow">Dataset</span>
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed font-body italic">
          Lock payment in escrow. The seller delivers the data and claims
          payment atomically.
        </p>
      </section>

      <div className="max-w-2xl">
        {/* Loading */}
        {phase === "loading" && (
          <div className="text-center py-20">
            <div className="flex justify-center mb-6">
              <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
            <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
              Loading listing details...
            </p>
          </div>
        )}

        {/* Ready */}
        {(phase === "ready" || phase === "minting" || phase === "purchasing") && listing && (
          <div className="space-y-10">
            {/* Listing details */}
            <div className="bg-surface p-8 border border-outline/30">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <span className="text-primary font-headline italic text-2xl font-bold">
                    {label(CATEGORY_LABELS, listing.category, "Category")}
                  </span>
                  <p className="text-on-surface-variant font-mono text-xs mt-1">
                    Listing #{listing.id}
                  </p>
                </div>
                <span className="text-2xl font-headline font-bold text-primary italic">
                  {listing.price.toString()} USDC
                </span>
              </div>

              <div className="space-y-4 font-mono text-[11px] tracking-wide">
                <div className="flex items-center justify-between py-2 border-b border-outline/10">
                  <span className="text-on-surface-variant uppercase">Device Type</span>
                  <span className="bg-surface-container px-2 py-0.5 text-[10px] text-on-surface font-bold">
                    {label(DEVICE_LABELS, listing.deviceId, "Device")}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-outline/10">
                  <span className="text-on-surface-variant uppercase">Verified Value Range</span>
                  <span className="text-on-surface font-bold">
                    {listing.valueMin.toString()} - {listing.valueMax.toString()}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-on-surface-variant uppercase">Attestor</span>
                  <div className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1 border border-primary/20">
                    <span
                      className="material-symbols-outlined text-xs"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      verified
                    </span>
                    <span className="font-bold text-[10px]">
                      {label(ATTESTOR_LABELS, listing.attestorId, "Attestor")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Mint test tokens */}
            {!hasMinted && phase === "ready" && (
              <div className="bg-surface-container border border-outline/30 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="material-symbols-outlined text-primary">
                    account_balance_wallet
                  </span>
                  <span className="font-mono text-xs text-on-surface uppercase tracking-wider font-bold">
                    Test Tokens Required
                  </span>
                </div>
                <p className="text-on-surface-variant text-xs font-body italic mb-4">
                  You need tokens in your private balance to purchase. Click below
                  to mint test tokens (MVP only).
                </p>
                <button
                  onClick={handleMint}
                  className="w-full py-3 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-surface text-on-surface border border-outline/30 hover:border-primary/40 transition-colors"
                >
                  Mint Test Tokens
                </button>
              </div>
            )}

            {hasMinted && phase === "ready" && (
              <div className="bg-primary/10 border border-primary/20 p-4 flex items-center gap-3">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  check_circle
                </span>
                <span className="font-mono text-xs text-primary uppercase tracking-wider">
                  Tokens minted and ready
                </span>
              </div>
            )}

            {/* Deadline */}
            {phase === "ready" && (
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                  Deadline (blocks from now, minimum 100)
                </label>
                <input
                  type="number"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  min="100"
                  className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                />
                <p className="text-on-surface-variant text-[10px] font-body italic mt-2">
                  If the seller doesn't deliver before the deadline, you can
                  reclaim your payment.
                </p>
              </div>
            )}

            {/* Confirm purchase */}
            {phase === "ready" && hasMinted && (
              <button
                onClick={handlePurchase}
                className="w-full py-4 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-primary text-on-primary hover:opacity-80 transition-opacity active:scale-[0.98]"
              >
                Lock Payment and Purchase
              </button>
            )}

            {/* Minting / Purchasing spinner */}
            {(phase === "minting" || phase === "purchasing") && (
              <div className="text-center py-10">
                <div className="flex justify-center mb-6">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
                <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest mb-2">
                  {statusMessage}
                </p>
                <p className="text-on-surface-variant/60 text-[10px] font-body italic">
                  This may take a minute or two
                </p>
              </div>
            )}
          </div>
        )}

        {/* Success */}
        {phase === "success" && (
          <div className="text-center py-20">
            <span
              className="material-symbols-outlined text-primary text-6xl mb-6 block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              lock
            </span>
            <h2 className="font-headline italic text-2xl font-bold text-on-surface mb-4">
              Payment Locked
            </h2>
            <p className="text-on-surface-variant font-body italic mb-8">
              Your payment is in escrow. The seller will deliver the data
              and claim payment atomically.
            </p>
            <button
              onClick={() => navigate("/browse")}
              className="inline-block bg-primary text-on-primary px-8 py-4 font-mono font-bold text-xs uppercase tracking-[0.2em] hover:opacity-80 transition-opacity active:scale-95"
            >
              Back to Browse
            </button>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="text-center py-20">
            <div className="w-12 h-12 mx-auto flex items-center justify-center bg-red-500/10 rounded-sm border border-red-500/30 mb-4">
              <span className="material-symbols-outlined text-red-400 text-2xl">
                error
              </span>
            </div>
            <p className="text-red-400 font-mono text-xs mb-4 max-w-lg mx-auto break-words">
              {errorMessage}
            </p>
            <button
              onClick={() => setPhase("ready")}
              className="text-primary font-mono text-xs uppercase tracking-wider hover:underline"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}