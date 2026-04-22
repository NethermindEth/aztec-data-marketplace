/**
 * Purchase screen — buyer locks payment for a listing.
 *
 * Features:
 *   - Checks private balance on load; skips mint if sufficient
 *   - Mints 10,000 tokens so buyer doesn't need to mint again
 *   - Calls refreshBalances() after mint and purchase (header updates)
 *   - Seller address from context's listingSellers map
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { fieldToName } from "../lib/nameEncoding.js";
import {
  MARKETPLACE_ADDRESS,
  TOKEN_ADDRESS,
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

const MINT_AMOUNT = 10_000n;

function label(map: Record<string, string>, key: bigint, fallback: string): string {
  return map[key.toString()] ?? `${fallback} ${key}`;
}

export default function Purchase() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const { wallet, accountAddress, paymentMethod, getListingSeller, privateBalance, refreshBalances } = useAztec();

  const [phase, setPhase] = useState<Phase>("loading");
  const [listing, setListing] = useState<ListingData | null>(null);
  const [sellerAddr, setSellerAddr] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("200");
  const [hasMinted, setHasMinted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Load listing details and check balance
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
        const listingData: ListingData = {
          id: Number(listingId),
          name: fieldToName(BigInt(r.name)),
          price: BigInt(r.price),
          category: BigInt(r.category),
          deviceId: BigInt(r.device_id),
          valueMin: BigInt(r.measurement_min),
          valueMax: BigInt(r.measurement_max),
          attestorId: BigInt(r.attestor_id),
          active: r.active,
        };
        setListing(listingData);

        // Look up seller from context
        const info = getListingSeller(Number(listingId));
        setSellerAddr(info?.seller ?? null);

        // Check if balance is sufficient (from context)
        if (privateBalance !== null && privateBalance >= listingData.price) {
          setHasMinted(true);
        }

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
  }, [wallet, accountAddress, listingId, getListingSeller, privateBalance]);

  // Also update hasMinted if balance changes after load
  useEffect(() => {
    if (listing && privateBalance !== null && privateBalance >= listing.price) {
      setHasMinted(true);
    }
  }, [privateBalance, listing]);

  // Mint test tokens
  async function handleMint() {
    if (!wallet || !accountAddress || !paymentMethod || !listing) return;

    setPhase("minting");
    setStatusMessage("Minting test tokens to your account...");

    try {
      const tokenAddress = TOKEN_ADDRESS();
      const token = TokenContract.at(tokenAddress, wallet);

      const adminSecret = ADMIN_SECRET();
      const adminSalt = ADMIN_SALT();
      const adminSigningKeyHex = ADMIN_SIGNING_KEY();
      const adminSigningKey = GrumpkinScalar.fromString(adminSigningKeyHex);
      const adminAccount = await wallet.createSchnorrAccount(adminSecret, adminSalt, adminSigningKey);

      const rawAdminAddr = adminAccount.address as any;
      const adminAddr = rawAdminAddr?.item
        ? AztecAddress.fromString(rawAdminAddr.item.toString())
        : adminAccount.address;

      setStatusMessage("Minting to public balance...");
      await token.methods.mint_to_public(accountAddress, MINT_AMOUNT).simulate({ from: adminAddr });
      await token.methods.mint_to_public(accountAddress, MINT_AMOUNT).send({
        from: adminAddr,
        fee: { paymentMethod },
        wait: { timeout: 60_000 },
      });

      setStatusMessage("Transferring to private balance...");
      await token.methods.transfer_to_private(accountAddress, MINT_AMOUNT).simulate({ from: accountAddress });
      await token.methods.transfer_to_private(accountAddress, MINT_AMOUNT).send({
        from: accountAddress,
        fee: { paymentMethod },
        wait: { timeout: 60_000 },
      });

      console.log("[purchase] Minted and transferred", MINT_AMOUNT.toString(), "tokens");

      await refreshBalances();
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
    if (!wallet || !accountAddress || !paymentMethod || !listing || !sellerAddr) return;

    setPhase("purchasing");
    setStatusMessage("Creating auth witness...");

    try {
      const tokenAddress = TOKEN_ADDRESS();
      const marketplaceAddress = MARKETPLACE_ADDRESS();
      const sellerAddress = AztecAddress.fromString(sellerAddr);
      const token = TokenContract.at(tokenAddress, wallet);

      const listingIdField = new Fr(BigInt(listing.id));
      const priceField = new Fr(listing.price);
      const deadlineField = new Fr(BigInt(deadline));

      const lockAction = token.methods.transfer_to_public(
        accountAddress, marketplaceAddress, listing.price, 0,
      );
      const authWit = await wallet.createAuthWit(accountAddress, {
        caller: marketplaceAddress,
        action: lockAction,
      });

      setStatusMessage("Simulating transaction...");
      const marketplace = MarketplaceContract.at(marketplaceAddress, wallet);

      await marketplace.methods
        .lock_payment(listingIdField, sellerAddress, priceField, tokenAddress, deadlineField)
        .with({ authWitnesses: [authWit] })
        .simulate({ from: accountAddress });

      setStatusMessage("Sending transaction (this may take a minute)...");
      await marketplace.methods
        .lock_payment(listingIdField, sellerAddress, priceField, tokenAddress, deadlineField)
        .with({ authWitnesses: [authWit] })
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 120_000 },
        });

      console.log("[purchase] Payment locked successfully");

      await refreshBalances();
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
            {/* No seller warning */}
            {!sellerAddr && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 p-4 rounded-sm">
                <p className="text-yellow-400 font-mono text-xs">
                  Seller address unknown for this listing. Create a listing from one account
                  and purchase from another in the same session.
                </p>
              </div>
            )}

            {/* Listing details */}
            <div className="bg-surface p-8 border border-outline/30">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <span className="text-primary font-headline italic text-2xl font-bold">
                    {listing.name || label(CATEGORY_LABELS, listing.category, "Category")}
                  </span>
                  <p className="text-on-surface-variant font-mono text-xs mt-1">
                    Listing #{listing.id} · {label(CATEGORY_LABELS, listing.category, "Category")}
                  </p>
                </div>
                <span className="text-2xl font-headline font-bold text-primary italic">
                  {listing.price.toString()} tokens
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

            {/* Mint test tokens — only if balance insufficient */}
            {!hasMinted && phase === "ready" && (
              <div className="bg-surface-container border border-outline/30 p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="material-symbols-outlined text-primary">
                    account_balance_wallet
                  </span>
                  <span className="font-mono text-xs text-on-surface uppercase tracking-wider font-bold">
                    Insufficient Balance
                  </span>
                </div>
                <p className="text-on-surface-variant text-xs font-body italic mb-4">
                  You need at least {listing.price.toString()} tokens to purchase.
                  {privateBalance !== null && privateBalance > 0n
                    ? ` Current balance: ${privateBalance.toLocaleString()}.`
                    : ""
                  }
                  {" "}Click below to mint test tokens (demo only).
                </p>
                <button
                  onClick={handleMint}
                  className="w-full py-3 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-surface text-on-surface border border-outline/30 hover:border-primary/40 transition-colors"
                >
                  Mint {MINT_AMOUNT.toLocaleString()} Test Tokens
                </button>
              </div>
            )}

            {/* Deadline */}
            {phase === "ready" && hasMinted && (
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
                disabled={!sellerAddr}
                className={`w-full py-4 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] active:scale-[0.98] transition-all rounded-sm ${
                  sellerAddr
                    ? "bg-primary text-on-primary hover:opacity-90"
                    : "bg-outline/30 text-on-surface-variant cursor-not-allowed"
                }`}
              >
                Lock Payment ({listing.price.toString()} tokens)
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
        {phase === "success" && listing && (
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
              {listing.price.toString()} tokens locked in escrow. The seller will
              deliver the data and claim payment. If they don't deliver before
              the deadline, you can reclaim your tokens.
            </p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => navigate("/browse")}
                className="bg-surface-container text-on-surface py-3 px-6 rounded-sm font-bold text-xs uppercase tracking-widest hover:border-primary/40 border border-outline/30 transition-colors"
              >
                Back to Browse
              </button>
              <Link
                to={`/deliver/${listing?.id}`}
                className="bg-primary text-on-primary py-3 px-6 rounded-sm font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all"
              >
                Go to Deliver
              </Link>
            </div>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="space-y-6">
            <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-sm">
              <p className="text-red-400 font-mono text-xs">{errorMessage}</p>
            </div>
            <button
              onClick={() => { setErrorMessage(""); setPhase("ready"); }}
              className="bg-surface-container text-on-surface py-3 px-6 rounded-sm font-bold text-xs transition-all uppercase tracking-widest hover:border-primary/40 border border-outline/30"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}