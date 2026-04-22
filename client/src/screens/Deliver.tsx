/**
 * Deliver screen — seller delivers data and claims escrowed payment.
 *
 * Flow:
 * 1. Load listing details
 * 2. Register the buyer as a sender for note discovery
 * 3. Call deliver_and_claim with the original data fields
 * 4. Call refreshBalances() so header shows updated public balance
 *
 * Buyer address is auto-inferred as the other account in the PXE.
 */

import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import { fieldToName } from "../lib/nameEncoding.js";
import {
  MARKETPLACE_ADDRESS,
  CATEGORY_LABELS,
  ATTESTOR_LABELS,
} from "../config.js";
import type { ListingData } from "../components/ListingCard.js";

type Phase = "loading" | "ready" | "registering" | "delivering" | "success" | "error";

function label(map: Record<string, string>, key: bigint, fallback: string): string {
  return map[key.toString()] ?? `${fallback} ${key}`;
}

export default function Deliver() {
  const { listingId } = useParams<{ listingId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { wallet, accountAddress, paymentMethod, accounts, getListingSeller, refreshBalances } = useAztec();

  const [phase, setPhase] = useState<Phase>("loading");
  const [listing, setListing] = useState<ListingData | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [buyerAddr, setBuyerAddr] = useState("");
  const [dataValue, setDataValue] = useState("");
  const [timestamp, setTimestamp] = useState("");
  const [deviceType, setDeviceType] = useState("");

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
          name: fieldToName(BigInt(r.name)),
          price: BigInt(r.price),
          category: BigInt(r.category),
          deviceId: BigInt(r.device_id),
          valueMin: BigInt(r.measurement_min),
          valueMax: BigInt(r.measurement_max),
          attestorId: BigInt(r.attestor_id),
          active: r.active,
        });

        // Buyer address: from URL param, or infer as the other account
        const buyerFromUrl = searchParams.get("buyer");
        if (buyerFromUrl) {
          setBuyerAddr(buyerFromUrl);
        } else {
          const otherAccounts = accounts.filter(
            (a) => a.toString() !== accountAddress!.toString(),
          );
          if (otherAccounts.length === 1) {
            setBuyerAddr(otherAccounts[0].toString());
          }
        }

        // Pre-fill data fields from listing info
        const listingInfo = getListingSeller(Number(listingId));
        if (listingInfo) {
          setDataValue(listingInfo.data0);
          setTimestamp(listingInfo.data1);
          setDeviceType(listingInfo.data2);
        }

        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[deliver] Failed to load listing:", err);
        setErrorMessage(err instanceof Error ? err.message : "Failed to load listing");
        setPhase("error");
      }
    }

    load();
    return () => { cancelled = true; };
  }, [wallet, accountAddress, listingId, searchParams, accounts]);

  async function handleDeliver() {
    if (!wallet || !accountAddress || !paymentMethod || !listing || !buyerAddr) return;

    try {
      setPhase("registering");
      setStatusMessage("Registering buyer for note discovery...");

      const buyerAddress = AztecAddress.fromString(buyerAddr);

      try {
        await wallet.registerSender(buyerAddress, `buyer-${listingId}`);
        console.log("[deliver] Registered buyer as sender:", buyerAddr);
      } catch (err) {
        console.warn("[deliver] registerSender warning:", err);
      }

      try {
        await wallet.registerSender(accountAddress, `seller-${listingId}`);
      } catch (err) {
        console.warn("[deliver] registerSender (self) warning:", err);
      }

      setPhase("delivering");
      setStatusMessage("Simulating deliver_and_claim...");

      const d0 = new Fr(BigInt(dataValue));
      const d1 = new Fr(BigInt(timestamp));
      const d2 = new Fr(BigInt(deviceType));
      const d3 = new Fr(0n);

      const listingIdField = new Fr(BigInt(listing.id));
      const marketplace = MarketplaceContract.at(MARKETPLACE_ADDRESS(), wallet);

      await marketplace.methods
        .deliver_and_claim(listingIdField, buyerAddress, d0, d1, d2, d3)
        .simulate({ from: accountAddress });

      setStatusMessage("Sending transaction (this may take a minute)...");
      await marketplace.methods
        .deliver_and_claim(listingIdField, buyerAddress, d0, d1, d2, d3)
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 120_000 },
        });

      console.log("[deliver] Data delivered and payment claimed");

      await refreshBalances();
      setPhase("success");
    } catch (err) {
      console.error("[deliver] Failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Delivery failed");
      setPhase("error");
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-16">
      {/* Hero */}
      <section className="mb-16">
        <h1 className="font-headline italic text-6xl font-bold tracking-tight mb-6">
          Deliver{" "}
          <span className="text-primary italic neon-glow">Data</span>
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed font-body italic">
          Deliver the committed data to the buyer and claim the escrowed payment.
          The contract verifies the content hash matches the original listing.
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
        {phase === "ready" && listing && (
          <div className="space-y-10">
            {/* Listing summary */}
            <div className="bg-surface p-8 border border-outline/30">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="text-primary font-headline italic text-2xl font-bold">
                    {listing.name || `Listing #${listing.id}`}
                  </span>
                  <p className="text-on-surface-variant font-mono text-xs mt-1">
                    Listing #{listing.id} · {label(CATEGORY_LABELS, listing.category, "Category")}
                  </p>
                </div>
                <span className="text-2xl font-headline font-bold text-primary italic">
                  {listing.price.toString()} tokens
                </span>
              </div>
              <div className="font-mono text-[11px] tracking-wide">
                <div className="flex justify-between py-2">
                  <span className="text-on-surface-variant uppercase">Status</span>
                  <span className={listing.active ? "text-primary font-bold" : "text-red-400 font-bold"}>
                    {listing.active ? "Active (payment locked)" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>

            {/* Buyer address */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                Buyer Address
              </label>
              <input
                type="text"
                value={buyerAddr}
                onChange={(e) => setBuyerAddr(e.target.value)}
                placeholder="0x..."
                className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-xs focus:border-primary/50 focus:outline-none"
              />
              <p className="text-on-surface-variant text-[10px] font-body italic mt-1">
                Auto-detected from your other account in this browser.
              </p>
            </div>

            {/* Data fields */}
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-6 border-b border-primary/20 pb-2">
                Data to Deliver
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Data Value
                  </label>
                  <input
                    type="number"
                    value={dataValue}
                    onChange={(e) => setDataValue(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Timestamp
                  </label>
                  <input
                    type="number"
                    value={timestamp}
                    onChange={(e) => setTimestamp(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Device Type
                  </label>
                  <input
                    type="number"
                    value={deviceType}
                    onChange={(e) => setDeviceType(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
              <p className="text-on-surface-variant text-[10px] font-body italic mt-3">
                These must match exactly what was committed at listing time.
                Pre-filled from listing data.
              </p>
            </div>

            {/* Deliver button */}
            <button
              onClick={handleDeliver}
              disabled={!buyerAddr || !dataValue}
              className={`w-full py-4 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] active:scale-[0.98] transition-all rounded-sm ${
                buyerAddr && dataValue
                  ? "bg-primary text-on-primary hover:opacity-90"
                  : "bg-outline/30 text-on-surface-variant cursor-not-allowed"
              }`}
            >
              Deliver Data and Claim Payment
            </button>
          </div>
        )}

        {/* Delivering spinner */}
        {(phase === "registering" || phase === "delivering") && (
          <div className="text-center py-20">
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

        {/* Success */}
        {phase === "success" && listing && (
          <div className="text-center py-20">
            <span
              className="material-symbols-outlined text-primary text-6xl mb-6 block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            <h2 className="font-headline italic text-2xl font-bold text-on-surface mb-4">
              Data Delivered
            </h2>
            <p className="text-on-surface-variant font-body italic mb-8">
              The data has been delivered to the buyer and {listing.price.toString()} tokens
              have been transferred to your public balance.
              The listing is now deactivated.
            </p>
            <button
              onClick={() => navigate("/browse")}
              className="bg-primary text-on-primary py-3 px-8 rounded-sm font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-all active:scale-[0.98]"
            >
              Back to Browse
            </button>
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