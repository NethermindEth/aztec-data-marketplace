import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ["buffer", "path", "process", "net", "tty", "util", "stream"],
    }),
  ],
  define: {
    "process.env": {},
  },
  optimizeDeps: {
    include: ["pino", "pino/browser"],
    exclude: [
      "@aztec/noir-noirc_abi",
      "@aztec/noir-acvm_js",
      "@aztec/bb.js",
      "@aztec/noir-noir_js",
    ],
  },
  build: {
    target: "esnext",
  },
});