// pdfjs-dist ships types for its display/worker_options surface but not for
// the worker entry module itself (pdf.worker.mjs) — parsePdf.ts imports its
// WorkerMessageHandler export directly (see that file's comment for why).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
