/**
 * Browse screen — displays all active listings from the marketplace.
 *
 * Reads public state via unconstrained utility functions:
 *  - get_next_listing_id() to learn how many listings exist
 *  - get_listing(id) for each listing
 *
 * These are fast (no proof generation) and use .simulate().
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAztec } from "../context.js";
import { MARKETPLACE_ADDRESS } from "../config.js";
import { Fr } from "@aztec/aztec.js/fields";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import ListingCard, { type ListingData } from "../components/ListingCard.js";

type Phase = "loading" | "ready" | "error";

export default function Browse() {
  const { wallet, accountAddress } = useAztec();
  const [phase, setPhase] = useState<Phase>("loading");
  const [listings, setListings] = useState<ListingData[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!wallet || !accountAddress) return;
    let cancelled = false;

    async function fetchListings() {
      try {
        const marketplace = MarketplaceContract.at(
          MARKETPLACE_ADDRESS(),
          wallet!,
        );

        // Get the total number of listings
        const nextIdResult = await marketplace.methods
          .get_next_listing_id()
          .simulate({ from: accountAddress! });
        const nextId = Number(BigInt(nextIdResult.result));

        console.log(`[browse] Found ${nextId - 1} listing(s)`);

        const fetched: ListingData[] = [];

        // Fetch each listing (IDs start at 1)
        for (let id = 1; id < nextId; id++) {
          if (cancelled) return;

          const listingResult = await marketplace.methods
            .get_listing(new Fr(BigInt(id)))
            .simulate({ from: accountAddress! });

          const r = listingResult.result;

          // Only include active listings
          if (!r.active) continue;

          fetched.push({
            id,
            price: BigInt(r.price),
            category: BigInt(r.category),
            deviceId: BigInt(r.device_id),
            valueMin: BigInt(r.value_min),
            valueMax: BigInt(r.value_max),
            attestorId: BigInt(r.attestor_id),
            active: r.active,
          });
        }

        if (cancelled) return;
        setListings(fetched);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[browse] Failed to fetch listings:", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to fetch listings",
        );
        setPhase("error");
      }
    }

    fetchListings();
    return () => { cancelled = true; };
  }, [wallet, accountAddress]);

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-16">
      {/* Hero */}
      <section className="mb-20">
        <h1 className="font-headline italic text-6xl font-bold tracking-tight mb-6">
          Explore{" "}
          <span className="text-primary italic neon-glow">Private Data</span>{" "}
          Listings
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed font-body italic">
          Browse verified, zero-knowledge attested health and wellness datasets.
          Every listing is cryptographically secured on Aztec Network.
        </p>
      </section>

      {/* Loading */}
      {phase === "loading" && (
        <div className="text-center py-20">
          <div className="flex justify-center mb-6">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
            Loading listings from marketplace...
          </p>
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
          <p className="text-red-400 font-mono text-xs mb-4">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-primary font-mono text-xs uppercase tracking-wider hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Ready — no listings */}
      {phase === "ready" && listings.length === 0 && (
        <div className="text-center py-20">
          <span
            className="material-symbols-outlined text-outline text-6xl mb-6 block"
            style={{ fontVariationSettings: "'FILL' 0" }}
          >
            inventory_2
          </span>
          <h2 className="font-headline italic text-2xl font-bold text-on-surface mb-4">
            No Listings Yet
          </h2>
          <p className="text-on-surface-variant font-body italic mb-8">
            Be the first to list data on the marketplace.
          </p>
          <Link
            to="/create"
            className="inline-block bg-primary text-on-primary px-8 py-4 font-mono font-bold text-xs uppercase tracking-[0.2em] hover:opacity-80 transition-opacity active:scale-95"
          >
            Create Listing
          </Link>
        </div>
      )}

      {/* Ready — with listings */}
      {phase === "ready" && listings.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-16">
          {/* Sidebar summary */}
          <aside className="w-full lg:w-64 shrink-0 space-y-8">
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-4 flex items-center gap-2 border-b border-primary/20 pb-2">
                <span className="material-symbols-outlined text-primary text-sm">
                  info
                </span>
                Marketplace
              </h3>
              <div className="space-y-3 font-mono text-[11px] tracking-wide">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant uppercase">
                    Total Listings
                  </span>
                  <span className="text-on-surface font-bold">
                    {listings.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant uppercase">
                    Active
                  </span>
                  <span className="text-primary font-bold">
                    {listings.filter((l) => l.active).length}
                  </span>
                </div>
              </div>
            </div>

            <Link
              to="/create"
              className="block w-full py-3 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-surface-container text-on-surface border border-outline/30 hover:border-primary/40 transition-colors text-center"
            >
              + Create Listing
            </Link>
          </aside>

          {/* Listing grid */}
          <div className="flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}