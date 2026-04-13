/**
 * React context — multi-account wallet state.
 *
 * Holds multiple accounts. The active account determines which address
 * is used for transactions. Any account can act as seller or buyer.
 *
 * Also maintains a listing-to-seller map so the buyer knows which
 * address to pass to lock_payment.
 *
 * Auto-reconnects on mount from IndexedDB (background, non-blocking).
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import {
  getWallet,
  getPaymentMethod,
  getExistingAccounts,
  resumeAccount,
} from "./aztec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListingInfo {
  seller: string;
  data0: string;
  data1: string;
  data2: string;
  data3: string;
}

export type ListingSellerMap = Record<number, ListingInfo>;

interface AztecState {
  wallet: EmbeddedWallet | null;
  accounts: AztecAddress[];
  activeIndex: number;
  paymentMethod: SponsoredFeePaymentMethod | null;
  isConnected: boolean;
  isReconnecting: boolean;

  addAccount: (
    wallet: EmbeddedWallet,
    address: AztecAddress,
    pm: SponsoredFeePaymentMethod,
  ) => void;
  switchAccount: (index: number) => void;
  disconnect: () => void;

  // Convenience — matches the old single-account interface so screens
  // that only read accountAddress don't need changes
  accountAddress: AztecAddress | null;

  // Listing-to-seller map
  listingSellers: ListingSellerMap;
  setListingSeller: (listingId: number, info: ListingInfo) => void;
  getListingSeller: (listingId: number) => ListingInfo | null;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const ACTIVE_INDEX_KEY = "aztec-market-active-index";
const LISTING_SELLERS_KEY = "aztec-market-listing-sellers";

function loadActiveIndex(): number {
  try {
    const saved = localStorage.getItem(ACTIVE_INDEX_KEY);
    if (saved !== null) return parseInt(saved, 10) || 0;
  } catch { /* ignore */ }
  return 0;
}

function saveActiveIndex(index: number) {
  try { localStorage.setItem(ACTIVE_INDEX_KEY, String(index)); } catch { /* ignore */ }
}

function loadListingSellers(): ListingSellerMap {
  try {
    const saved = localStorage.getItem(LISTING_SELLERS_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

function saveListingSellers(map: ListingSellerMap) {
  try { localStorage.setItem(LISTING_SELLERS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AztecContext = createContext<AztecState | null>(null);

export function AztecProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<EmbeddedWallet | null>(null);
  const [accounts, setAccounts] = useState<AztecAddress[]>([]);
  const [activeIndex, setActiveIndex] = useState(loadActiveIndex);
  const [paymentMethod, setPaymentMethod] =
    useState<SponsoredFeePaymentMethod | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(true);
  const [listingSellers, setListingSellers] = useState<ListingSellerMap>(loadListingSellers);

  // -- addAccount -----------------------------------------------------------
  const addAccount = useCallback(
    (w: EmbeddedWallet, addr: AztecAddress, pm: SponsoredFeePaymentMethod) => {
      setWallet(w);
      setPaymentMethod(pm);
      setAccounts((prev) => {
        const exists = prev.some((a) => a.toString() === addr.toString());
        if (exists) return prev;
        const next = [...prev, addr];
        const newIndex = next.length - 1;
        setActiveIndex(newIndex);
        saveActiveIndex(newIndex);
        return next;
      });
    },
    [],
  );

  // -- switchAccount --------------------------------------------------------
  const switchAccount = useCallback(
    (index: number) => {
      setActiveIndex(index);
      saveActiveIndex(index);
    },
    [],
  );

  // -- disconnect -----------------------------------------------------------
  const disconnect = useCallback(() => {
    setWallet(null);
    setAccounts([]);
    setPaymentMethod(null);
    setActiveIndex(0);
    saveActiveIndex(0);
  }, []);

  // -- listing seller map ---------------------------------------------------
  const setListingSeller = useCallback(
    (listingId: number, info: ListingInfo) => {
      setListingSellers((prev) => {
        const next = { ...prev, [listingId]: info };
        saveListingSellers(next);
        return next;
      });
    },
    [],
  );

  const getListingSeller = useCallback(
    (listingId: number): ListingInfo | null => {
      return listingSellers[listingId] ?? null;
    },
    [listingSellers],
  );

  // -- auto-reconnect on mount (background, non-blocking) -------------------
  useEffect(() => {
    let cancelled = false;

    async function reconnect() {
      try {
        const w = await getWallet();
        if (cancelled) return;

        const existingAccounts = await getExistingAccounts(w);
        if (cancelled) return;

        if (existingAccounts.length > 0) {
          await resumeAccount(w);
          if (cancelled) return;

          const pm = getPaymentMethod();
          setWallet(w);
          setAccounts(existingAccounts);
          setPaymentMethod(pm);

          // Register all accounts as senders for note discovery
          if (existingAccounts.length > 1) {
            const { registerSenders } = await import("./aztec.js");
            await registerSenders(existingAccounts);
          }

          const savedIndex = loadActiveIndex();
          const clamped = Math.min(savedIndex, existingAccounts.length - 1);
          setActiveIndex(clamped);

          console.log(
            `[context] Auto-reconnected ${existingAccounts.length} account(s), active: ${clamped}`,
          );
        } else {
          console.log("[context] No existing accounts found");
        }
      } catch (err) {
        console.error("[context] Auto-reconnect failed:", err);
      } finally {
        if (!cancelled) setIsReconnecting(false);
      }
    }

    reconnect();
    return () => { cancelled = true; };
  }, []);

  // -- derived --------------------------------------------------------------
  const activeAccount = accounts[activeIndex] ?? null;

  return (
    <AztecContext.Provider
      value={{
        wallet,
        accounts,
        activeIndex,
        paymentMethod,
        isConnected: wallet !== null && accounts.length > 0,
        isReconnecting,
        addAccount,
        switchAccount,
        disconnect,
        accountAddress: activeAccount,
        listingSellers,
        setListingSeller,
        getListingSeller,
      }}
    >
      {children}
    </AztecContext.Provider>
  );
}

export function useAztec(): AztecState {
  const ctx = useContext(AztecContext);
  if (!ctx) throw new Error("useAztec must be used inside <AztecProvider>");
  return ctx;
}