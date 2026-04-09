/**
 * React context providing wallet and account state to the entire app.
 *
 * After the Gateway screen connects/creates an account, this context holds:
 *  - The EmbeddedWallet instance
 *  - The active account address
 *  - The sponsored fee payment method
 *
 * All downstream screens read from this context instead of re-initialising.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AztecState {
  wallet: EmbeddedWallet | null;
  accountAddress: AztecAddress | null;
  paymentMethod: SponsoredFeePaymentMethod | null;
  isConnected: boolean;
  setConnection: (
    wallet: EmbeddedWallet,
    address: AztecAddress,
    pm: SponsoredFeePaymentMethod,
  ) => void;
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AztecContext = createContext<AztecState | null>(null);

export function AztecProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<EmbeddedWallet | null>(null);
  const [accountAddress, setAccountAddress] = useState<AztecAddress | null>(
    null,
  );
  const [paymentMethod, setPaymentMethod] =
    useState<SponsoredFeePaymentMethod | null>(null);

  const setConnection = useCallback(
    (
      w: EmbeddedWallet,
      addr: AztecAddress,
      pm: SponsoredFeePaymentMethod,
    ) => {
      setWallet(w);
      setAccountAddress(addr);
      setPaymentMethod(pm);
    },
    [],
  );

  const disconnect = useCallback(() => {
    setWallet(null);
    setAccountAddress(null);
    setPaymentMethod(null);
  }, []);

  return (
    <AztecContext.Provider
      value={{
        wallet,
        accountAddress,
        paymentMethod,
        isConnected: wallet !== null && accountAddress !== null,
        setConnection,
        disconnect,
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