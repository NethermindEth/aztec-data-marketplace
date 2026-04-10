import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AztecProvider } from "./context.js";
import App from "./App.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AztecProvider>
        <App />
      </AztecProvider>
    </BrowserRouter>
  </StrictMode>,
);