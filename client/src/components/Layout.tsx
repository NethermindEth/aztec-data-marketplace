import { Link, Outlet } from "react-router-dom";
import { useAztec } from "../context.js";

/** Truncate an Aztec address for display: 0x2e7f...4b3c */
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Layout() {
  const { isConnected, accountAddress, disconnect } = useAztec();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 shadow-[0_20px_40px_rgba(14,14,52,0.4)]">
        <div className="flex justify-between items-center w-full px-8 py-4">
          <Link
            to="/"
            className="text-2xl font-headline italic text-primary tracking-tight"
          >
            AZTEC MARKET
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
            </div>
          )}

          <div className="flex items-center gap-4">
            {isConnected && accountAddress ? (
              <div className="flex items-center gap-3">
                <span className="text-on-surface-variant font-mono text-xs">
                  {truncateAddress(accountAddress.toString())}
                </span>
                <button
                  onClick={disconnect}
                  className="text-outline hover:text-primary text-xs font-mono uppercase tracking-wider transition-colors"
                >
                  Disconnect
                </button>
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

      {/* Page content */}
      <main className="flex-grow">
        <Outlet />
      </main>
    </div>
  );
}