import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Without this, Next bundles pdfjs-dist into the serverless function
  // instead of requiring it from node_modules at runtime — which breaks
  // its optional @napi-rs/canvas dependency (a native binary that can't be
  // inlined into a JS bundle) and crashes with "DOMMatrix is not defined"
  // on every route that imports the Paragraph IV PDF parser, even ones
  // that never actually call it (e.g. /data), since it's pulled into the
  // same server chunk. Only reproduces in a real deployment, not `next
  // dev` — Turbopack's dev server resolves node_modules directly instead
  // of bundling.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
