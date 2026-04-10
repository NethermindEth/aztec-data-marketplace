/**
 * Create Listing screen — seller lists attested health data.
 *
 * Flow:
 * 1. Seller fills form (data value, timestamp, device, price, category, range)
 * 2. Client computes content hash (Poseidon2 with DOM_SEP_FUNCTION_ARGS)
 * 3. Signs with test attestor P-256 key via Web Crypto
 * 4. Normalises to low-s
 * 5. Calls create_listing with all parameters
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAztec } from "../context.js";
import { Fr } from "@aztec/aztec.js/fields";
import { MarketplaceContract } from "../../../test/artifacts/Marketplace.js";
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
  const { wallet, accountAddress, paymentMethod } = useAztec();

  // Form state
  const [dataValue, setDataValue] = useState("68");
  const [timestamp, setTimestamp] = useState(
    Math.floor(Date.now() / 1000).toString(),
  );
  const [deviceType, setDeviceType] = useState("1");
  const [price, setPrice] = useState("100");
  const [category, setCategory] = useState("1");
  const [valueMin, setValueMin] = useState("40");
  const [valueMax, setValueMax] = useState("200");

  // Status
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
      // 1. Convert form values to Fr
      setPhase("signing");
      setStatusMessage("Preparing data fields...");

      const d0 = new Fr(BigInt(dataValue));
      const d1 = new Fr(BigInt(timestamp));
      const d2 = new Fr(BigInt(deviceType));
      const d3 = new Fr(0n); // reserved

      const priceField = new Fr(BigInt(price));
      const categoryField = new Fr(BigInt(category));
      const valueMinField = new Fr(BigInt(valueMin));
      const valueMaxField = new Fr(BigInt(valueMax));
      const deviceIdField = new Fr(BigInt(deviceType)); // must match d2

      // 2. Compute content hash
      setStatusMessage("Computing content hash...");
      const contentHash = await computeContentHash(d0, d1, d2, d3);
      console.log("[create] Content hash:", contentHash.toString());

      // 3. Import attestor private key and sign
      setStatusMessage("Signing with attestor key...");
      const privateKey = await importP256PrivateKey(ATTESTOR_PRIVATE_KEY());
      const signature = await signContentHash(contentHash, privateKey);
      console.log("[create] Signature computed (64 bytes, low-s normalised)");

      // 4. Convert signature and public key to Field arrays
      const sigFields = bytesToFieldArray(signature, 64);

      const pkXBytes = hexToBytes(ATTESTOR_PUBLIC_KEY_X());
      const pkYBytes = hexToBytes(ATTESTOR_PUBLIC_KEY_Y());
      const pkXFields = bytesToFieldArray(pkXBytes, 32);
      const pkYFields = bytesToFieldArray(pkYBytes, 32);

      // 5. Get contract addresses
      const tokenAddress = TOKEN_ADDRESS();
      const registryAddress = REGISTRY_ADDRESS();
      const attestorId = ATTESTOR_ID;

      // 6. Call create_listing
      setPhase("submitting");
      setStatusMessage("Simulating transaction...");

      const marketplace = MarketplaceContract.at(
        MARKETPLACE_ADDRESS(),
        wallet,
      );

      await marketplace.methods
        .create_listing(
          d0, d1, d2, d3,
          priceField, tokenAddress, categoryField,
          valueMinField, valueMaxField, deviceIdField,
          attestorId, registryAddress,
          sigFields, pkXFields, pkYFields,
        )
        .simulate({ from: accountAddress });

      setStatusMessage("Sending transaction (this may take a minute)...");

      await marketplace.methods
        .create_listing(
          d0, d1, d2, d3,
          priceField, tokenAddress, categoryField,
          valueMinField, valueMaxField, deviceIdField,
          attestorId, registryAddress,
          sigFields, pkXFields, pkYFields,
        )
        .send({
          from: accountAddress,
          fee: { paymentMethod },
          wait: { timeout: 120_000 },
        });

      console.log("[create] Listing created successfully");
      setPhase("success");
      setStatusMessage("Listing created!");

      // Navigate to browse after a moment
      setTimeout(() => navigate("/browse"), 2000);
    } catch (err) {
      console.error("[create] Failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create listing",
      );
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
          List your attested health data on the marketplace. The contract
          verifies your attestor's signature and data properties before
          publishing.
        </p>
      </section>

      <div className="max-w-2xl">
        {/* Form */}
        {phase === "form" && (
          <div className="space-y-10">
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
                    placeholder="e.g. 68 (heart rate BPM)"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Timestamp (Unix)
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
                      <option key={val} value={val}>
                        {lbl}
                      </option>
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
                      <option key={val} value={val}>
                        {lbl}
                      </option>
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
                    Value Min
                  </label>
                  <input
                    type="number"
                    value={valueMin}
                    onChange={(e) => setValueMin(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-[0.2em] text-on-surface-variant mb-2">
                    Value Max
                  </label>
                  <input
                    type="number"
                    value={valueMax}
                    onChange={(e) => setValueMax(e.target.value)}
                    className="w-full bg-surface-container border border-outline/30 text-on-surface px-4 py-3 font-mono text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Attestor info */}
            <div className="bg-surface-container border border-outline/30 p-6">
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="material-symbols-outlined text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  verified
                </span>
                <span className="font-mono text-xs text-on-surface uppercase tracking-wider font-bold">
                  Test Attestor (ID {ATTESTOR_ID.toString()})
                </span>
              </div>
              <p className="text-on-surface-variant text-xs font-body italic">
                The listing will be signed with the test attestor's P-256 key.
                The contract verifies this signature and checks the key against
                the attestor registry.
              </p>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="w-full py-4 px-4 font-mono font-bold text-xs uppercase tracking-[0.2em] bg-primary text-on-primary hover:opacity-80 transition-opacity active:scale-[0.98]"
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
            {phase === "submitting" && (
              <p className="text-on-surface-variant/60 text-[10px] font-body italic">
                Transaction may take up to two minutes
              </p>
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
              onClick={() => setPhase("form")}
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