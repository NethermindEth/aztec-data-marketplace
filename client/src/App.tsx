import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.js";
import Gateway from "./screens/Gateway.js";
import Browse from "./screens/Browse.js";

// Placeholder screens — will be built next
function CreateListing() {
  return (
    <div className="p-12 text-center text-on-surface-variant font-mono text-sm uppercase tracking-widest">
      Create listing — coming soon
    </div>
  );
}

function Purchase() {
  return (
    <div className="p-12 text-center text-on-surface-variant font-mono text-sm uppercase tracking-widest">
      Purchase — coming soon
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Gateway />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/create" element={<CreateListing />} />
        <Route path="/purchase/:listingId" element={<Purchase />} />
      </Route>
    </Routes>
  );
}