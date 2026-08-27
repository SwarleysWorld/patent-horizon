// pdfjs-dist's legacy Node build unconditionally constructs a DOMMatrix at
// module-load time (canvas-rendering setup), even though this app only
// extracts text/geometry (getTextContent/getOperatorList) and never
// actually renders a page — so it crashes on import unless something
// provides a DOMMatrix global first. pdfjs-dist's own fallback tries to
// load @napi-rs/canvas (a native binary) for this, which is unreliable to
// deploy on Vercel (its build's file-tracer doesn't reliably include a
// dynamically-`require`d native binary, even though it installs fine).
//
// A pure-JS polyfill sidesteps that entirely: setting globalThis.DOMMatrix
// here, before pdfjs-dist is imported, makes pdfjs-dist skip its own
// @napi-rs/canvas attempt (see its `if (!globalThis.DOMMatrix)` check in
// pdf.mjs). This only needs to exist, not be functionally complete — the
// matrix math it's missing (e.g. preMultiplySelf/invertSelf) is only
// exercised by pdfjs-dist's page.render() canvas path, which this app
// never calls.
import DOMMatrixPolyfill from "@thednp/dommatrix";

if (typeof globalThis.DOMMatrix === "undefined") {
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixPolyfill;
}
