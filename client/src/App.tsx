import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.js";
import Gateway from "./screens/Gateway.js";
import Browse from "./screens/Browse.js";
import CreateListing from "./screens/CreateListing.js";
import Purchase from "./screens/Purchase.js";
import Deliver from "./screens/Deliver.js";
import ReceivedData from "./screens/ReceivedData.js";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Gateway />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/create" element={<CreateListing />} />
        <Route path="/purchase/:listingId" element={<Purchase />} />
        <Route path="/deliver/:listingId" element={<Deliver />} />
        <Route path="/received" element={<ReceivedData />} />
      </Route>
    </Routes>
  );
}