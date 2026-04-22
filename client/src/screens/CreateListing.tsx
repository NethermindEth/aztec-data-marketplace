/**
 * Create Listing screen — seller lists attested health data.
 *
 * Original UI preserved. Only functional change: stores listing-to-seller
 * mapping in context after successful creation.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
import { nameToField } from "../lib/nameEncoding.js";
import {
  MARKETPLACE_ADDRESS,
  REGISTRY_ADDRESS,
  TOKEN_ADDRESS,
  ATTESTOR_ID,
  ATTESTOR_PUBLIC_KEY_X,
  ATTESTOR_PUBLIC_KEY_Y,
  ATTESTOR_PRIVATE_KEY,
  CATEGORY_LABELS,
  DEVICE_LABELS,
} from "../config.js";
import {
  computeContentHash,
  signContentHash,
  importP256PrivateKey,
  hexToBytes,
  bytesToFieldArray,
} from "../crypto.js";

type Phase = "form" | "signing" | "submitting" | "success" | "error";

export default function CreateListing() {
  const navigate = useNavigate();
  const { wallet, accountAddress, paymentMethod, setListingSeller } = useAztec();

  const [dataValue, setDataValue] = useState("68");
  const [timestamp, setTimestamp] = useState(
    Math.floor(Date.now() / 1000).toString(),
  );
  const [deviceType, setDeviceType] = useState("1");
  const [price, setPrice] = useState("100");
  const [category, setCategory] = useState("1");
  const [measurementMin, setMeasurementMin] = useState("40");
  const [measurementMax, setMeasurementMax] = useState("200");
  const [name, setName] = useState("");

  const [phase, setPhase] = useState<Phase>("form");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit() {
    if (!wallet || !accountAddress || !paymentMethod) {
      setErrorMessage("Wallet not connected");
      setPhase("error");
      return;
    }

    try {
      setPhase("signing");
      setStatusMessage("Preparing data fields...");

      const d0 = new Fr(BigInt(dataValue));
      const d1 = new Fr(BigInt(timestamp));
      const d2 = new Fr(BigInt(deviceType));
      const d3 = new Fr(0n);

      const priceField = new Fr(BigInt(price));
      const categoryField = new Fr(BigInt(category));
      const measurementMinField = new Fr(BigInt(measurementMin));
      const measurementMaxField = new Fr(BigInt(measurementMax));
      const deviceIdField = new Fr(BigInt(deviceType));
      const nameField = nameToField(name);

      setStatusMessage("Computing content hash...");
      const contentHash = await computeContentHash(d0, d1, d2, d3);
      console.log("[create] Content hash:", contentHash.toString());

      setStatusMessage("Signing with attestor key...");
      const privateKey = await importP256PrivateKey(ATTESTOR_PRIVATE_KEY());
      const signature = await signContentHash(contentHash, privateKey);
      console.log("[create] Signature computed (64 bytes, low-s normalised)");

      const sigFields = bytesToFieldArray(signature, 64);
      const pkXBytes = hexToBytes(ATTESTOR_PUBLIC_KEY_X());
      const pkYBytes = hexToBytes(ATTESTOR_PUBLIC_KEY_Y());
      const pkXFields = bytesToFieldArray(pkXBytes, 32);
      const pkYFields = bytesToFieldArray(pkYBytes, 32);

      const tokenAddress = TOKEN_ADDRESS();
      const registryAddress = REGISTRY_ADDRESS();
      const attestorId = ATTESTOR_ID;

      setPhase("submitting");
      setStatusMessage("Simulating transaction...");

      const marketplace = MarketplaceContract.at(MARKETPLACE_ADDRESS(), wallet);

      await marketplace.methods
        .create_listing(
          d0, d1, d2, d3,
          priceField, tokenAddress, categoryField,
          measurementMinField, measurementMaxField, deviceIdField,
          nameField, attestorId, registryAddress,
          sigFields, pkXFields, pkYFields,
        )
        .simulate({ from: accountAddress });

      setStatusMessage("Sending transaction (this may take a minute)...");

      await marketplace.methods
        .create_listing(
          d0, d1, d2, d3,
          priceField, tokenAddress, categoryField,
          measurementMinField, measurementMaxField, deviceIdField,
          nameField, attestorId, registryAddress,
          sigFields, pkXFields, pkYFields,
        )
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 120_000 },
        });

      console.log("[create] Listing created successfully");

      // Store listing-to-seller mapping so buyer knows the seller address
      try {
        const nextIdResult = await marketplace.methods
          .get_next_listing_id()
          .simulate({ from: accountAddress });
        const nextId = Number(BigInt(nextIdResult.result));
        const createdId = nextId - 1;
        setListingSeller(createdId, {
          seller: accountAddress.toString(),
          data0: dataValue,
          data1: timestamp,
          data2: deviceType,
          data3: "0",
        });
        console.log(`[create] Stored listing info: listing ${createdId} -> ${accountAddress.toString()}`);
      } catch (err) {
        console.warn("[create] Could not store seller mapping:", err);
      }

      setPhase("success");
      setStatusMessage("Listing created!");
      setTimeout(() => navigate("/browse"), 2000);
    } catch (err) {
      console.error("[create] Failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to create listing");
      setPhase("error");
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-16">
      {/* Hero */}
      <section className="mb-16">
        <h1 className="font-headline italic text-6xl font-bold tracking-tight mb-6">
          Create a{" "}
          <span className="text-primary italic neon-glow">New Listing</span>
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-lg leading-relaxed font-body italic">
          List your data on the marketplace. The contract verifies the attestor signature and data properties before publishing.
        </p>
      </section>

      <div className="max-w-2xl">
        {/* Form */}
        {phase === "form" && (
          <div className="space-y-10">
            {/* Listing name */}
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-6 border-b border-primary/20 pb-2">
                Listing Name
              </h3>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={31}
                placeholder="e.g. Resting HR - Apple Watch 7d"
                className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
              />
              <p className="text-on-surface-variant/60 text-[10px] font-body italic mt-2">
                Public label. Up to 31 characters. Not part of the content hash.
              </p>
            </div>

            {/* Data fields */}
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-6 border-b border-primary/20 pb-2">
                Data Fields
              </h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Measurement Value
                  </label>
                  <input
                    type="number"
                    value={dataValue}
                    onChange={(e) => setDataValue(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                    placeholder="e.g. 68 (heart rate bpm)"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Timestamp (unix)
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
                  <select
                    value={deviceType}
                    onChange={(e) => setDeviceType(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  >
                    {Object.entries(DEVICE_LABELS).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([val, lbl]) => (
                      <option key={val} value={val}>{lbl}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Listing parameters */}
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-6 border-b border-primary/20 pb-2">
                Listing Parameters
              </h3>
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Price (tokens)
                  </label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Measurement Min
                  </label>
                  <input
                    type="number"
                    value={measurementMin}
                    onChange={(e) => setMeasurementMin(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Measurement Max
                  </label>
                  <input
                    type="number"
                    value={measurementMax}
                    onChange={(e) => setMeasurementMax(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Attestor info */}
            <div>
              <h3 className="font-headline italic font-bold text-xl mb-6 border-b border-primary/20 pb-2">
                Attestation
              </h3>
              <div className="bg-surface-container border border-outline/20 p-4 font-mono text-[11px] space-y-2 rounded-sm">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant uppercase">Attestor ID</span>
                  <span className="text-primary">1 (App Attest)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant uppercase">Signature</span>
                  <span className="text-on-surface">ECDSA P-256 (auto-signed)</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              className="w-full bg-primary text-on-primary py-4 rounded-sm font-bold text-xs active:scale-[0.98] transition-all uppercase tracking-widest hover:opacity-90"
            >
              Sign and Create Listing
            </button>
          </div>
        )}

        {/* Signing / Submitting */}
        {(phase === "signing" || phase === "submitting") && (
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
        {phase === "success" && (
          <div className="text-center py-20">
            <span
              className="material-symbols-outlined text-primary text-6xl mb-6 block"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              check_circle
            </span>
            <h2 className="font-headline italic text-2xl font-bold text-on-surface mb-4">
              Listing Created
            </h2>
            <p className="text-on-surface-variant font-body italic">
              Redirecting to browse...
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
              onClick={() => { setErrorMessage(""); setPhase("form"); }}
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