import { Link } from "react-router-dom";
import {
  CATEGORY_LABELS,
  DEVICE_LABELS,
  ATTESTOR_LABELS,
} from "../config.js";

export interface ListingData {
  id: number;
  name: string;
  price: bigint;
  category: bigint;
  deviceId: bigint;
  valueMin: bigint;
  valueMax: bigint;
  attestorId: bigint;
  active: boolean;
}

function label(map: Record<string, string>, key: bigint, fallback: string): string {
  return map[key.toString()] ?? `${fallback} ${key}`;
}

export default function ListingCard({ listing }: { listing: ListingData }) {
  const category = label(CATEGORY_LABELS, listing.category, "Category");
  const device = label(DEVICE_LABELS, listing.deviceId, "Device");
  const attestor = label(ATTESTOR_LABELS, listing.attestorId, "Attestor");
  const displayName = listing.name || `Listing #${listing.id}`;

  return (
    <div className="bg-surface p-8 border border-outline/30 hover:border-primary/50 transition-all duration-500 group">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div className="flex flex-col gap-3 min-w-0 pr-4">
          <span className="text-primary font-headline italic text-2xl font-bold truncate">
            {displayName}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-[0.15em] border border-primary/20">
              {category}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[9px] font-mono text-primary uppercase tracking-[0.2em]">
                Active
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className="block text-2xl font-headline font-bold text-primary italic">
            {listing.price.toString()} USDC
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-4 mb-10 font-mono text-[11px] tracking-wide">
        <div className="flex items-center justify-between py-2 border-b border-outline/10">
          <span className="text-on-surface-variant uppercase">Listing ID</span>
          <span className="text-on-surface font-bold">#{listing.id}</span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-outline/10">
          <span className="text-on-surface-variant uppercase">Device Type</span>
          <span className="bg-surface-container px-2 py-0.5 text-[10px] text-on-surface font-bold">
            {device}
          </span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-outline/10">
          <span className="text-on-surface-variant uppercase">Verified Measurement Range</span>
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
            <span className="font-bold text-[10px]">{attestor}</span>
          </div>
        </div>
      </div>

      {/* Purchase button */}
      <Link
        to={`/purchase/${listing.id}`}
        className="block w-full py-4 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-primary text-on-primary hover:opacity-80 transition-opacity active:scale-95 text-center"
      >
        Purchase Dataset
      </Link>
    </div>
  );
}