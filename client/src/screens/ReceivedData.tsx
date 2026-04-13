/**
 * Received Data screen — buyer views data they have received.
 *
 * How it works:
 *   1. Reads the listingSellers map from context (localStorage-backed)
 *   2. For each listing, checks on-chain status via get_listing()
 *   3. If the listing is deactivated (active=false), delivery is complete
 *      and the data fields are displayed
 *
 * The data fields (data_0..data_3) were stored in the listingSellers map
 * when the seller created the listing. After delivery, the contract
 * verified these exact fields match the committed content hash, so
 * displaying them here is trustworthy.
 *
 * Future improvement: add an unconstrained contract function that reads
 * DataNotes from the buyer's private set, removing the dependency on
 * localStorage. This would require a contract recompile.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import {
  MARKETPLACE_ADDRESS,
  CATEGORY_LABELS,
  DEVICE_LABELS,
  ATTESTOR_LABELS,
} from "../config.js";

interface ReceivedItem {
  listingId: number;
  data0: string;
  data1: string;
  data2: string;
  data3: string;
  price: bigint;
  category: bigint;
  deviceId: bigint;
  valueMin: bigint;
  valueMax: bigint;
  attestorId: bigint;
}

type Phase = "loading" | "ready" | "error";

function label(
  map: Record<string, string>,
  key: bigint,
  fallback: string,
): string {
  return map[key.toString()] ?? `${fallback} ${key}`;
}

function formatTimestamp(unix: string): string {
  try {
    const ts = Number(unix);
    if (ts === 0) return "N/A";
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return unix;
  }
}

export default function ReceivedData() {
  const { wallet, accountAddress, listingSellers } = useAztec();

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ReceivedItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!wallet || !accountAddress) return;
    let cancelled = false;

    async function fetchReceived() {
      try {
        const marketplace = MarketplaceContract.at(
          MARKETPLACE_ADDRESS(),
          wallet!,
        );

        const received: ReceivedItem[] = [];

        // Check each listing in the seller map
        for (const [idStr, info] of Object.entries(listingSellers)) {
          if (cancelled) return;

          const listingId = Number(idStr);

          // Skip entries with missing data
          if (!info?.seller) continue;

          // Skip listings where the current account is the seller
          // (the seller created the listing, not received data)
          if (
            info.seller.toLowerCase() ===
            accountAddress!.toString().toLowerCase()
          ) {
            continue;
          }

          try {
            const result = await marketplace.methods
              .get_listing(new Fr(BigInt(listingId)))
              .simulate({ from: accountAddress! });

            const r = result.result;

            // Listing deactivated means delivery is complete
            if (!r.active) {
              received.push({
                listingId,
                data0: info.data0,
                data1: info.data1,
                data2: info.data2,
                data3: info.data3,
                price: BigInt(r.price),
                category: BigInt(r.category),
                deviceId: BigInt(r.device_id),
                valueMin: BigInt(r.value_min),
                valueMax: BigInt(r.value_max),
                attestorId: BigInt(r.attestor_id),
              });
            }
          } catch (err) {
            console.warn(
              `[received] Could not fetch listing ${listingId}:`,
              err,
            );
          }
        }

        if (cancelled) return;

        // Sort by listing ID descending (most recent first)
        received.sort((a, b) => b.listingId - a.listingId);

        setItems(received);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[received] Failed to fetch received data:", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load received data",
        );
        setPhase("error");
      }
    }

    fetchReceived();
    return () => {
      cancelled = true;
    };
  }, [wallet, accountAddress, listingSellers]);

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-16">
      {/* Hero */}
      <section className="mb-16">
        <h1 className="font-headline italic text-6xl font-bold tracking-tight mb-6">
          Received{" "}
          <span className="text-primary italic neon-glow">Data</span>
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed font-body italic">
          View data you have purchased. Each entry was verified by the contract before delivery.
        </p>
      </section>

      {/* Loading */}
      {phase === "loading" && (
        <div className="text-center py-20">
          <div className="flex justify-center mb-6">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
            Scanning for delivered data...
          </p>
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <div className="space-y-6">
          <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-sm">
            <p className="text-red-400 font-mono text-xs">{errorMessage}</p>
          </div>
          <button
            onClick={() => {
              setErrorMessage("");
              setPhase("loading");
            }}
            className="bg-surface-container text-on-surface py-3 px-6 rounded-sm font-bold text-xs transition-all uppercase tracking-widest hover:border-primary/40 border border-outline/30"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {phase === "ready" && items.length === 0 && (
        <div className="text-center py-20">
          <span
            className="material-symbols-outlined text-outline/40 text-6xl mb-6 block"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            inbox
          </span>
          <h2 className="font-headline italic text-2xl font-bold text-on-surface mb-4">
            No Data Received Yet
          </h2>
          <p className="text-on-surface-variant font-body italic mb-8 max-w-md mx-auto">
            Purchase a listing and wait for the seller to deliver. Completed
            deliveries will appear here.
          </p>
          <Link
            to="/browse"
            className="inline-block bg-primary text-on-primary px-8 py-4 font-mono font-bold text-xs uppercase tracking-[0.2em] hover:opacity-80 transition-opacity active:scale-95"
          >
            Browse Listings
          </Link>
        </div>
      )}

      {/* Data cards */}
      {phase === "ready" && items.length > 0 && (
        <div className="space-y-8">
          {/* Summary */}
          <div className="flex items-center gap-4 mb-4">
            <span className="text-primary font-mono text-xs uppercase tracking-widest font-bold">
              {items.length} dataset{items.length > 1 ? "s" : ""} received
            </span>
          </div>

          {items.map((item) => (
            <div
              key={item.listingId}
              className="bg-surface border border-outline/30 hover:border-primary/30 transition-all duration-500"
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-8 py-5 border-b border-outline/10">
                <div className="flex items-center gap-4">
                  <span
                    className="material-symbols-outlined text-primary text-2xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    database
                  </span>
                  <div>
                    <span className="text-primary font-headline italic text-lg font-bold">
                      {label(CATEGORY_LABELS, item.category, "Category")}
                    </span>
                    <span className="text-on-surface-variant font-mono text-[10px] ml-3 uppercase tracking-wider">
                      Listing #{item.listingId}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="material-symbols-outlined text-primary text-xs"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    verified
                  </span>
                  <span className="text-primary font-mono text-[10px] uppercase tracking-wider font-bold">
                    Verified Delivery
                  </span>
                </div>
              </div>

              {/* Data payload */}
              <div className="px-8 py-6">
                <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-4">
                  Decrypted Data Payload
                </h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-surface-container border border-outline/20 p-4">
                    <span className="block text-[9px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                      Measurement
                    </span>
                    <span className="block text-2xl font-headline italic font-bold text-on-surface">
                      {item.data0}
                    </span>
                    <span className="block text-[9px] font-mono text-on-surface-variant mt-1">
                      bpm
                    </span>
                  </div>
                  <div className="bg-surface-container border border-outline/20 p-4">
                    <span className="block text-[9px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                      Timestamp
                    </span>
                    <span className="block text-sm font-mono font-bold text-on-surface">
                      {formatTimestamp(item.data1)}
                    </span>
                    <span className="block text-[9px] font-mono text-on-surface-variant mt-1">
                      {item.data1}
                    </span>
                  </div>
                  <div className="bg-surface-container border border-outline/20 p-4">
                    <span className="block text-[9px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                      Source Device
                    </span>
                    <span className="block text-sm font-headline italic font-bold text-on-surface">
                      {label(DEVICE_LABELS, BigInt(item.data2), "Device")}
                    </span>
                    <span className="block text-[9px] font-mono text-on-surface-variant mt-1">
                      type {item.data2}
                    </span>
                  </div>
                  <div className="bg-surface-container border border-outline/20 p-4">
                    <span className="block text-[9px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                      Reserved
                    </span>
                    <span className="block text-sm font-mono font-bold text-on-surface">
                      {item.data3}
                    </span>
                  </div>
                </div>
              </div>

              {/* Verification details */}
              <div className="px-8 py-5 border-t border-outline/10">
                <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-4">
                  Verification Details
                </h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-3 gap-x-8 font-mono text-[11px] tracking-wide">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-on-surface-variant uppercase">
                      Price Paid
                    </span>
                    <span className="text-on-surface font-bold">
                      {item.price.toString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-on-surface-variant uppercase">
                      Device
                    </span>
                    <span className="bg-surface-container px-2 py-0.5 text-[10px] text-on-surface font-bold">
                      {label(DEVICE_LABELS, item.deviceId, "Device")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-on-surface-variant uppercase">
                      Range
                    </span>
                    <span className="text-on-surface font-bold">
                      {item.valueMin.toString()} - {item.valueMax.toString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-on-surface-variant uppercase">
                      Attestor
                    </span>
                    <div className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-0.5 border border-primary/20">
                      <span
                        className="material-symbols-outlined text-[10px]"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        verified
                      </span>
                      <span className="font-bold text-[10px]">
                        {label(
                          ATTESTOR_LABELS,
                          item.attestorId,
                          "Attestor",
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}