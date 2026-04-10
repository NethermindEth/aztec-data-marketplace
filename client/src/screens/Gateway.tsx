/**
 * Gateway screen — connect or create an Aztec account.
 *
 * Flow:
 * 1. Initialise EmbeddedWallet (PXE in browser, persists to IndexedDB)
 * 2. Check for existing accounts
 *    - If found: show "Resume" option with truncated address
 *    - If not: show "Create New Account" button
 * 3. On connect/create: register contracts, set context, navigate to /browse
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAztec } from "../context.js";
import {
  getWallet,
  getPaymentMethod,
  getExistingAccounts,
  createAccount,
  resumeAccount,
} from "../aztec.js";
import type { AztecAddress } from "@aztec/aztec.js/addresses";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type Phase =
  | "initialising"   // loading wallet / checking IndexedDB
  | "ready"          // wallet loaded, showing options
  | "creating"       // deploying a new account
  | "resuming"       // resuming an existing account
  | "error";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Gateway() {
  const navigate = useNavigate();
  const { isConnected, setConnection } = useAztec();

  const [phase, setPhase] = useState<Phase>("initialising");
  const [existingAccounts, setExistingAccounts] = useState<AztecAddress[]>([]);
  const [statusMessage, setStatusMessage] = useState("Connecting to Aztec node...");
  const [errorMessage, setErrorMessage] = useState("");

  // If already connected (e.g. back-navigated), redirect to browse
  useEffect(() => {
    if (isConnected) navigate("/browse", { replace: true });
  }, [isConnected, navigate]);

  // On mount: initialise wallet and check for existing accounts
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        setStatusMessage("Connecting to Aztec node...");
        const wallet = await getWallet();

        if (cancelled) return;
        setStatusMessage("Checking for existing accounts...");

        const accounts = await getExistingAccounts(wallet);
        if (cancelled) return;

        setExistingAccounts(accounts);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("Gateway init failed:", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to connect to Aztec node",
        );
        setPhase("error");
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  async function handleCreateAccount() {
    setPhase("creating");
    setStatusMessage("Generating keys...");

    try {
      const { address } = await createAccount((msg) => setStatusMessage(msg));
      const wallet = await getWallet();
      const pm = getPaymentMethod();

      setConnection(wallet, address, pm);
      navigate("/browse");
    } catch (err) {
      console.error("Account creation failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Account creation failed",
      );
      setPhase("error");
    }
  }

  async function handleResume(address: AztecAddress) {
    setPhase("resuming");
    setStatusMessage("Registering contracts...");

    try {
      const wallet = await getWallet();
      await resumeAccount(wallet);

      const pm = getPaymentMethod();
      setConnection(wallet, address, pm);
      navigate("/browse");
    } catch (err) {
      console.error("Resume failed:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to resume account",
      );
      setPhase("error");
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="relative flex items-center justify-center overflow-hidden py-24 px-6 min-h-[calc(100vh-73px)]">
      {/* Background blurs */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[140px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-outline/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
        {/* Hero */}
        <div className="flex flex-col space-y-10">
          <div>
            <span className="text-primary font-mono text-[11px] font-medium tracking-[0.3em] uppercase mb-6 block">
              AZTEC NETWORK // SECURE
            </span>
            <h1 className="text-7xl font-headline italic font-bold text-on-surface leading-[1.05] tracking-tight">
              The Private <br />
              <span className="text-primary italic neon-glow">
                Data Economy
              </span>
            </h1>
          </div>

          <p className="text-on-surface-variant text-xl max-w-md leading-relaxed font-body">
            A marketplace where data sovereignty is a fundamental right.
            Sell your health data with zero-knowledge privacy guarantees.
          </p>

          <div className="grid grid-cols-2 gap-8 pt-6">
            <div className="p-8 rounded-sm bg-surface border border-outline/30 hover:border-primary/40 transition-colors group">
              <span
                className="material-symbols-outlined text-primary text-4xl mb-4 group-hover:scale-110 transition-transform block"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                shield_lock
              </span>
              <h3 className="text-on-surface font-headline italic font-bold text-lg mb-2">
                Encrypted Flows
              </h3>
              <p className="text-on-surface-variant text-sm font-body leading-relaxed">
                Your data remains hidden, even during active trade.
              </p>
            </div>
            <div className="p-8 rounded-sm bg-surface border border-outline/30 hover:border-primary/40 transition-colors group">
              <span
                className="material-symbols-outlined text-primary text-4xl mb-4 group-hover:scale-110 transition-transform block"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                visibility_off
              </span>
              <h3 className="text-on-surface font-headline italic font-bold text-lg mb-2">
                Total Anonymity
              </h3>
              <p className="text-on-surface-variant text-sm font-body leading-relaxed">
                Zero-knowledge proofs verify without disclosure.
              </p>
            </div>
          </div>
        </div>

        {/* Connection panel */}
        <div className="glass-panel p-1 w-full max-w-md mx-auto rounded-lg shadow-[0_40px_80px_-15px_rgba(0,0,0,0.6)]">
          <div className="bg-surface rounded-md p-10 space-y-10">
            <div className="text-center">
              <h2 className="text-3xl font-headline italic font-bold text-on-surface">
                Secure Gateway
              </h2>
              <p className="text-on-surface-variant text-sm mt-3 font-body italic">
                Access your private Aztec account
              </p>
            </div>

            {/* ---- Initialising ---- */}
            {phase === "initialising" && (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
                <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
                  {statusMessage}
                </p>
              </div>
            )}

            {/* ---- Ready: existing accounts ---- */}
            {phase === "ready" && existingAccounts.length > 0 && (
              <div className="space-y-6">
                {/* Resume section */}
                <div className="space-y-3">
                  <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-[0.2em] block ml-1">
                    Resume Existing Account
                  </span>
                  {existingAccounts.map((addr) => (
                    <div
                      key={addr.toString()}
                      className="flex items-center justify-between p-5 rounded-sm bg-surface-container border border-primary/20"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 flex items-center justify-center bg-background rounded-sm border border-outline/30">
                          <span className="material-symbols-outlined text-primary">
                            fingerprint
                          </span>
                        </div>
                        <div className="text-left">
                          <p className="text-on-surface font-mono text-sm tracking-tighter">
                            {truncateAddress(addr.toString())}
                          </p>
                          <p className="text-on-surface-variant text-[10px] font-body italic">
                            Stored in browser
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleResume(addr)}
                        className="bg-primary text-on-primary px-4 py-2 rounded-sm font-bold text-[10px] uppercase tracking-wider hover:opacity-90 transition-opacity"
                      >
                        Continue
                      </button>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-outline/30" />
                  </div>
                  <div className="relative flex justify-center text-[10px]">
                    <span className="bg-surface px-6 text-on-surface-variant font-mono uppercase tracking-[0.2em]">
                      or
                    </span>
                  </div>
                </div>

                {/* Create new */}
                <button
                  onClick={handleCreateAccount}
                  className="w-full bg-surface-container text-on-surface py-4 rounded-sm font-bold text-xs transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:border-primary/40 border border-outline/30"
                >
                  <span
                    className="material-symbols-outlined text-[20px] text-primary"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    person_add
                  </span>
                  Create New Account
                </button>
              </div>
            )}

            {/* ---- Ready: no existing accounts ---- */}
            {phase === "ready" && existingAccounts.length === 0 && (
              <div className="space-y-4">
                <button
                  onClick={handleCreateAccount}
                  className="w-full bg-primary text-on-primary py-4 rounded-sm font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:opacity-90"
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    person_add
                  </span>
                  Create New Account
                </button>
                <p className="text-center text-[10px] text-on-surface-variant leading-relaxed px-4 font-mono uppercase tracking-widest">
                  Built-in browser security via IndexedDB
                </p>
              </div>
            )}

            {/* ---- Creating / Resuming ---- */}
            {(phase === "creating" || phase === "resuming") && (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
                <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
                  {statusMessage}
                </p>
                {phase === "creating" && (
                  <p className="text-on-surface-variant/60 text-[10px] font-body italic">
                    Account deployment can take up to two minutes
                  </p>
                )}
              </div>
            )}

            {/* ---- Error ---- */}
            {phase === "error" && (
              <div className="space-y-6 text-center">
                <div className="w-12 h-12 mx-auto flex items-center justify-center bg-red-500/10 rounded-sm border border-red-500/30">
                  <span className="material-symbols-outlined text-red-400 text-2xl">
                    error
                  </span>
                </div>
                <p className="text-red-400 font-mono text-xs">
                  {errorMessage}
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="text-primary font-mono text-xs uppercase tracking-wider hover:underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Footer note */}
            <p className="text-center text-[11px] text-on-surface-variant leading-relaxed px-6 font-body italic">
              Your keys are generated locally and stored in your browser.
              No external wallet required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}