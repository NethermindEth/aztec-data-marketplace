/**
 * Gateway screen — connect or create Aztec accounts.
 *
 * Original UI preserved: glass-panel, feature cards, Material Symbols.
 * Added: multi-account support, resume all, create additional accounts.
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

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type Phase =
  | "waiting"
  | "initialising"
  | "ready"
  | "creating"
  | "resuming"
  | "error";

export default function Gateway() {
  const navigate = useNavigate();
  const { isReconnecting, accounts, addAccount } = useAztec();

  const [phase, setPhase] = useState<Phase>("waiting");
  const [existingAccounts, setExistingAccounts] = useState<AztecAddress[]>([]);
  const [statusMessage, setStatusMessage] = useState("Connecting to Aztec node...");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (isReconnecting) return;
    let cancelled = false;

    async function init() {
      try {
        setPhase("initialising");
        setStatusMessage("Connecting to Aztec node...");
        const wallet = await getWallet();
        if (cancelled) return;
        setStatusMessage("Checking for existing accounts...");
        const existing = await getExistingAccounts(wallet);
        if (cancelled) return;
        setExistingAccounts(existing);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("Gateway init failed:", err);
        setErrorMessage(err instanceof Error ? err.message : "Failed to connect to Aztec node");
        setPhase("error");
      }
    }

    init();
    return () => { cancelled = true; };
  }, [isReconnecting]);

  async function handleCreateAccount() {
    setPhase("creating");
    setStatusMessage("Generating keys...");
    try {
      const { address } = await createAccount((msg) => setStatusMessage(msg));
      const wallet = await getWallet();
      const pm = getPaymentMethod();
      addAccount(wallet, address, pm);

      // Register all accounts as senders for note discovery
      const existing = await getExistingAccounts(wallet);
      setExistingAccounts(existing);

      if (existing.length > 1) {
        const { registerSenders } = await import("../aztec.js");
        await registerSenders(existing);
      }
      setPhase("ready");
    } catch (err) {
      console.error("Account creation failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Account creation failed");
      setPhase("error");
    }
  }

  async function handleResumeAll() {
    setPhase("resuming");
    setStatusMessage("Registering contracts...");
    try {
      const wallet = await getWallet();
      await resumeAccount(wallet);
      const pm = getPaymentMethod();
      for (const addr of existingAccounts) {
        addAccount(wallet, addr, pm);
      }
      navigate("/browse");
    } catch (err) {
      console.error("Resume failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to resume accounts");
      setPhase("error");
    }
  }

  const connectedCount = accounts.length;

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
              AZTEC NETWORK
            </span>
            <h1 className="text-7xl font-headline italic font-bold text-on-surface leading-[1.05] tracking-tight">
              The Private <br />
              <span className="text-primary italic neon-glow">
                Data Economy
              </span>
            </h1>
          </div>

          <p className="text-on-surface-variant text-xl max-w-md leading-relaxed font-body">
            Your data. Your price. Zero exposure.
          </p>

          <div className="grid grid-cols-2 gap-8 pt-6">
            <div className="p-8 rounded-sm bg-surface border border-outline/30 hover:border-primary/40 transition-colors group">
              <span
                className="material-symbols-outlined text-primary text-4xl mb-4 group-hover:scale-110 transition-transform block"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                visibility_off
              </span>
              <h3 className="text-on-surface font-headline italic font-bold text-lg mb-2">
                Private by Default
              </h3>
              <p className="text-on-surface-variant text-sm font-body leading-relaxed">
                Seller identity, buyer identity, and data content are hidden on-chain. Only listing metadata is public.
              </p>
            </div>
            <div className="p-8 rounded-sm bg-surface border border-outline/30 hover:border-primary/40 transition-colors group">
              <span
                className="material-symbols-outlined text-primary text-4xl mb-4 group-hover:scale-110 transition-transform block"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                shield_lock
              </span>
              <h3 className="text-on-surface font-headline italic font-bold text-lg mb-2">
                Verified Provenance
              </h3>
              <p className="text-on-surface-variant text-sm font-body leading-relaxed">
                Every listing is cryptographically proven to come from a trusted source. No fabricated data enters the marketplace
              </p>
            </div>
          </div>
        </div>

        {/* Connection panel — glass-panel style */}
        <div className="glass-panel p-1 w-full max-w-md mx-auto rounded-lg shadow-[0_40px_80px_-15px_rgba(0,0,0,0.6)]">
          <div className="bg-surface rounded-md p-10 space-y-10">
            {/* Waiting / Initialising */}
            {(phase === "waiting" || phase === "initialising") && (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
                <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
                  {statusMessage}
                </p>
              </div>
            )}

            {/* Ready: existing accounts, not yet connected */}
            {phase === "ready" && existingAccounts.length > 0 && connectedCount === 0 && (
              <div className="space-y-6">
                <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-[0.2em] block ml-1">
                  Resume Existing Accounts
                </span>
                {existingAccounts.map((addr) => (
                  <div
                    key={addr.toString()}
                    className="flex items-center justify-between p-5 rounded-sm bg-surface-container border border-primary/20"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 flex items-center justify-center bg-background rounded-sm border border-outline/30">
                        <span className="material-symbols-outlined text-primary">fingerprint</span>
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
                  </div>
                ))}
                <button
                  onClick={handleResumeAll}
                  className="w-full bg-primary text-on-primary py-4 rounded-sm font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:opacity-90"
                >
                  Resume All ({existingAccounts.length})
                </button>
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-outline/30" />
                  </div>
                  <div className="relative flex justify-center text-[10px]">
                    <span className="bg-surface px-6 text-on-surface-variant font-mono uppercase tracking-[0.2em]">or</span>
                  </div>
                </div>
                <button
                  onClick={handleCreateAccount}
                  className="w-full bg-surface-container text-on-surface py-4 rounded-sm font-bold text-xs transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:border-primary/40 border border-outline/30"
                >
                  <span className="material-symbols-outlined text-[20px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>person_add</span>
                  Create New Account
                </button>
              </div>
            )}

            {/* Ready: already connected */}
            {phase === "ready" && connectedCount > 0 && (
              <div className="space-y-6">
                <div className="bg-primary/10 border border-primary/20 p-4 rounded-sm">
                  <p className="text-primary font-mono text-xs">
                    {connectedCount} account{connectedCount > 1 ? "s" : ""} connected
                  </p>
                  <div className="mt-2 space-y-1">
                    {accounts.map((addr, i) => (
                      <p key={addr.toString()} className="text-on-surface-variant font-mono text-[10px]">
                        Account {i + 1}: {truncateAddress(addr.toString())}
                      </p>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => navigate("/browse")}
                  className="w-full bg-primary text-on-primary py-4 rounded-sm font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:opacity-90"
                >
                  Enter Marketplace
                </button>
                <button
                  onClick={handleCreateAccount}
                  className="w-full bg-surface-container text-on-surface py-4 rounded-sm font-bold text-xs transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:border-primary/40 border border-outline/30"
                >
                  <span className="material-symbols-outlined text-[20px] text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>person_add</span>
                  Create Another Account
                </button>
                {connectedCount === 1 && (
                  <p className="text-center text-[10px] text-on-surface-variant leading-relaxed px-4 font-mono uppercase tracking-widest">
                    Tip: create a second account to test the full buyer/seller flow
                  </p>
                )}
              </div>
            )}

            {/* Ready: no accounts at all */}
            {phase === "ready" && existingAccounts.length === 0 && connectedCount === 0 && (
              <div className="space-y-4">
                <button
                  onClick={handleCreateAccount}
                  className="w-full bg-primary text-on-primary py-4 rounded-sm font-bold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-3 uppercase tracking-widest hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>person_add</span>
                  Create New Account
                </button>
              </div>
            )}

            {/* Creating / Resuming */}
            {(phase === "creating" || phase === "resuming") && (
              <div className="space-y-6 text-center">
                <div className="flex justify-center">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
                <p className="text-on-surface-variant font-mono text-xs uppercase tracking-widest">
                  {statusMessage}
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
                  onClick={() => { setErrorMessage(""); setPhase("ready"); }}
                  className="w-full bg-surface-container text-on-surface py-3 rounded-sm font-bold text-xs transition-all uppercase tracking-widest hover:border-primary/40 border border-outline/30"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}