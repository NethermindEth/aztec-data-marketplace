/**
 * Layout shell — header with nav, account switcher, balances, and page outlet.
 *
 * Shows private and public token balances for the active account.
 * Balances refresh on account switch and after transactions (via context).
 */

import { useState, useRef, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAztec } from "../context.js";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatBalance(bal: bigint | null): string {
  if (bal === null) return "...";
  return bal.toLocaleString();
}

export default function Layout() {
  const {
    isConnected,
    isReconnecting,
    accounts,
    activeIndex,
    accountAddress,
    switchAccount,
    disconnect,
    privateBalance,
    publicBalance,
  } = useAztec();

  const location = useLocation();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close dropdown on route change
  useEffect(() => { setDropdownOpen(false); }, [location]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 shadow-[0_20px_40px_rgba(14,14,52,0.4)]">
        <div className="flex justify-between items-center w-full px-8 py-4">
          <Link
            to="/"
            className="text-2xl font-headline italic text-primary tracking-tight"
          >
            AZTEC Data Marketplace
          </Link>

          {isConnected && (
            <div className="hidden md:flex items-center gap-10">
              <Link
                to="/browse"
                className="text-outline hover:text-primary transition-colors font-headline italic"
              >
                Browse
              </Link>
              <Link
                to="/create"
                className="text-outline hover:text-primary transition-colors font-headline italic"
              >
                Create
              </Link>
              <Link
                to="/received"
                className="text-outline hover:text-primary transition-colors font-headline italic"
              >
                Received
              </Link>
            </div>
          )}

          <div className="flex items-center gap-4">
            {/* Balances */}
            {isConnected && accountAddress && (privateBalance !== null || publicBalance !== null) && (
              <div className="hidden lg:flex items-center gap-4 mr-2">
                {privateBalance !== null && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="material-symbols-outlined text-primary text-sm"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      lock
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {formatBalance(privateBalance)}
                    </span>
                  </div>
                )}
                {publicBalance !== null && (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="material-symbols-outlined text-primary text-sm"
                      style={{ fontVariationSettings: "'FILL' 0" }}
                    >
                      public
                    </span>
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {formatBalance(publicBalance)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {isConnected && accountAddress ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 text-on-surface-variant font-mono text-xs hover:text-primary transition-colors"
                >
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span>{truncateAddress(accountAddress.toString())}</span>
                  {accounts.length > 1 && (
                    <span className="text-[10px] text-on-surface-variant">
                      ({activeIndex + 1}/{accounts.length})
                    </span>
                  )}
                  <span className="material-symbols-outlined text-xs">
                    expand_more
                  </span>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-surface border border-outline/30 shadow-2xl z-50">
                    <div className="px-4 py-3 border-b border-outline/20">
                      <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-on-surface-variant">
                        Accounts
                      </span>
                    </div>

                    {accounts.map((addr, i) => (
                      <button
                        key={addr.toString()}
                        onClick={() => {
                          switchAccount(i);
                          setDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                          i === activeIndex
                            ? "bg-primary/10 border-l-2 border-primary"
                            : "hover:bg-surface-container border-l-2 border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="material-symbols-outlined text-sm text-primary">
                            fingerprint
                          </span>
                          <div>
                            <p className="font-mono text-xs text-on-surface">
                              {truncateAddress(addr.toString())}
                            </p>
                            <p className="text-[9px] text-on-surface-variant font-body italic">
                              Account {i + 1}
                            </p>
                          </div>
                        </div>
                        {i === activeIndex && (
                          <span className="text-[9px] font-mono text-primary uppercase tracking-wider">
                            Active
                          </span>
                        )}
                      </button>
                    ))}

                    <div className="border-t border-outline/20">
                      <Link
                        to="/"
                        className="block w-full px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.15em] text-on-surface-variant hover:text-primary transition-colors"
                      >
                        + Add Account
                      </Link>
                      <button
                        onClick={() => { disconnect(); setDropdownOpen(false); }}
                        className="w-full px-4 py-3 text-left text-[10px] font-mono uppercase tracking-[0.15em] text-red-400 hover:text-red-300 transition-colors"
                      >
                        Disconnect All
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : isReconnecting ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-on-surface-variant font-mono text-xs">
                  Connecting...
                </span>
              </div>
            ) : (
              <Link
                to="/"
                className="bg-primary text-on-primary px-6 py-2.5 rounded-sm font-bold text-sm uppercase tracking-wider transition-transform active:scale-95"
              >
                Connect
              </Link>
            )}
          </div>
        </div>
        <div className="bg-gradient-to-b from-outline-variant to-transparent h-px" />
      </header>

      <main className="flex-grow">
        <Outlet />
      </main>
    </div>
  );
}