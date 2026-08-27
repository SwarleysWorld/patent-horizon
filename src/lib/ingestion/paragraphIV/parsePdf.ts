// Parses FDA's Paragraph IV Patent Certifications List PDF.
//
// FDA's PDF has no exposed text-based table markup — table structure is
// implied by (a) an invisible full-width background rectangle behind each
// row (used purely to shade alternating rows), and (b) consistent column
// x-positions repeated identically on every page (confirmed directly
// against pages 1, 2, 50, and 96 of a real download — pixel-identical
// header positions on all four). Row boundaries come from (a); column
// assignment comes from each text item's own x-position against the
// header-derived column boundaries — extracted from the PDF's own drawing
// commands and text-item positions via pdfjs-dist's operator list, rather
// than guessing row boundaries from line-spacing heuristics (which breaks
// on cells that wrap across a different number of lines than their
// neighbors — verified this exact failure mode during development).
//
// An earlier version of this parser keyed column assignment off a
// per-cell clip rectangle instead of each item's own x-position. FDA's PDF
// only draws that per-cell rect for a cell whose content needs
// wrap-clipping — a short or empty cell has no rect of its own — so that
// approach silently broke once enough rows in a given file had no
// individual per-cell rects to key off, and fell back to the row's own
// full-width background rect, corrupting many rows by merging every
// column's text into column 0. Confirmed via a live download: the
// full-width background rect is reliably present exactly once per row,
// with no gaps or duplicates, across pages 1, 2, 3, 50, and 96 — it's used
// for that one purpose now, not for column geometry.
//
// The original per-cell-rect approach was validated against a real
// downloaded copy of the PDF before being written here: reconstructed row
// count matched a reference extraction exactly (1,632/1,632), and cell
// content matched byte-for-byte on 1,626/1,632 rows, with the remaining 6
// differing only by a missing inter-word space in a free-text cell. Any
// future regression should be re-validated the same way against a fresh
// download, not assumed away.
import "./domMatrixPolyfill";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { DecisionHistoryEntry, ParsedChallenge, ParseResult, PivDecisionStatus, RowIssue } from "./types";

// pdfjs-dist's Node "fake worker" resolves via a runtime `import("./pdf.worker.mjs")`
// relative to its own package directory — fine running this file directly (tsx),
// but under Next's bundler the module executes from a chunk file inside .next/,
// so that relative path resolves nowhere and every parse fails with "Setting up
// fake worker failed: Cannot find module '.../pdf.worker.mjs'". Pointing
// GlobalWorkerOptions.workerSrc at an absolute on-disk path looks like a fix but
// isn't reliable here: Turbopack can give the route chunk and the worker chunk
// separately-bundled copies of pdf.mjs, each with its own GlobalWorkerOptions
// class/static state, so a value set on one copy is invisible to the other.
// Importing WorkerMessageHandler statically (bundler-resolved at build time, no
// runtime import() involved) and handing it to pdfjs via the documented
// `globalThis.pdfjsWorker` escape hatch skips that dynamic import entirely.
(globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler } }).pdfjsWorker = {
  WorkerMessageHandler,
};

export const COLUMN_KEYS = [
  "activeIngredient",
  "dosageForm",
  "strength",
  "rldNda",
  "dateOfSubmission",
  "numberOfAndas",
  "status180Day",
  "posting180Day",
  "firstApplicantApproval",
  "firstCommercialMarketing",
  "expirationLastQualifyingPatent",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
const NUM_COLUMNS = COLUMN_KEYS.length;

interface TextItem {
  str: string;
  x: number;
  y: number;
}

interface CellRect {
  x1: number;
  y1: number;
  y2: number;
  x2: number;
}

// ---- Low-level PDF geometry extraction ----------------------------------

async function loadDocument(pdfBytes: Buffer) {
  const data = new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength);
  return pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
}

// pdf.js's own TextItem type isn't part of its public export surface (only
// a handful of top-level types are re-exported — confirmed against the
// installed package) — this local shape covers only what's actually used.
interface RawTextItem {
  str: string;
  transform: number[];
}

async function getPageItems(page: pdfjsLib.PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent();
  return (content.items as RawTextItem[])
    .filter((it) => it.str.trim().length > 0)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
}

// Every filled/clipped path pdf.js records via OPS.constructPath carries a
// [minX, minY, maxX, maxY] bounding box as its third argument (confirmed
// empirically against this exact PDF — not part of pdf.js's public API
// contract, so this is inherently tied to the pdf.js version pinned in
// package.json; re-verify against a real download if that version ever
// changes and this starts silently returning 0 rows).
async function getCellRects(page: pdfjsLib.PDFPageProxy): Promise<CellRect[]> {
  const opList = await page.getOperatorList();
  const rects: CellRect[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== pdfjsLib.OPS.constructPath) continue;
    const bbox = (opList.argsArray[i] as unknown[])[2] as
      | { 0: number; 1: number; 2: number; 3: number }
      | undefined;
    if (!bbox) continue;
    const x1 = bbox[0];
    const y1 = Math.min(bbox[1], bbox[3]);
    const y2 = Math.max(bbox[1], bbox[3]);
    const x2 = bbox[2];
    const key = `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rects.push({ x1, y1, y2, x2 });
  }
  return rects;
}

// Derives column x-boundaries and the header/body divider y from page 1's
// own header row, rather than hardcoding pixel constants — resilient to a
// future minor FDA template tweak (a changed constant would otherwise fail
// silently; this fails loudly instead if the expected structure isn't
// found). Header label text sits in a y band above all real data;
// clustering by x with a gap threshold well above normal word-wrap spacing
// (confirmed against a real download: same-column wrapped words are up to
// ~21pt apart at most; distinct columns are always >44pt apart) recovers
// the 11 column starts without needing to match exact label wording. The
// band's upper bound excludes the page title/date banner sitting above
// the header (confirmed real: banner text starts around y=555, well
// separated from the header labels' y=504-531).
const HEADER_BAND_Y_MIN = 495;
const HEADER_BAND_Y_MAX = 550;
const CLUSTER_GAP_THRESHOLD = 25;

function deriveColumnBounds(headerItems: TextItem[]): number[] {
  const xs = [...new Set(headerItems.map((it) => Math.round(it.x)))].sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const x of xs) {
    if (clusters.length === 0 || x - clusters[clusters.length - 1] > CLUSTER_GAP_THRESHOLD) {
      clusters.push(x);
    }
  }
  if (clusters.length !== NUM_COLUMNS) {
    throw new Error(
      `expected ${NUM_COLUMNS} header columns, found ${clusters.length} (x-clusters: ${clusters.join(", ")}) — FDA may have changed the PDF's table layout; re-verify against a fresh download`,
    );
  }
  const bounds = clusters.map((start, i) => (i === 0 ? 0 : (clusters[i - 1] + start) / 2));
  bounds.push(clusters[clusters.length - 1] + 300); // generous right sentinel, wider than any real column
  return bounds;
}

function deriveHeaderBodyDividerY(rects: CellRect[], headerItems: TextItem[]): number {
  const headerTextY = Math.min(...headerItems.map((it) => it.y));
  // The header's own per-cell clip rects span the header text band; their
  // y1 (bottom edge) is exactly where the first data row begins. The page
  // also has full-page background/border rects that trivially satisfy a
  // plain "spans headerTextY" test (confirmed real: one such rect made
  // this resolve to y1=0, silently discarding every row) — the height
  // bound excludes those while still comfortably covering a real header
  // cell's height (~38pt in the reference file).
  const headerRects = rects.filter((r) => r.y1 < headerTextY && r.y2 > headerTextY && r.y2 - r.y1 < 100);
  if (headerRects.length === 0) {
    throw new Error("could not locate the header row's cell rectangles to derive the header/body divider");
  }
  return Math.min(...headerRects.map((r) => r.y1));
}

function colIndexForX(x: number, bounds: number[]): number {
  for (let i = 0; i < bounds.length - 1; i++) {
    if (x >= bounds[i] && x < bounds[i + 1]) return i;
  }
  return bounds.length - 2;
}

// Joins a pre-selected set of text items (already scoped to one row's y-band
// and one column's x-range — see extractRawRows below) into that cell's
// text, preserving line order top-to-bottom.
function linesFromItems(cellItems: TextItem[]): string {
  const lineMap = new Map<number, TextItem[]>();
  for (const it of cellItems) {
    const y = Math.round(it.y);
    (lineMap.get(y) ?? lineMap.set(y, []).get(y)!).push(it);
  }
  const lines = [...lineMap.entries()].sort((a, b) => b[0] - a[0]); // top to bottom
  return lines
    .map(([, lineItems]) => {
      const sorted = [...lineItems].sort((a, b) => a.x - b.x);
      // Insert a space between adjacent same-line items when there's a
      // real gap, not just normal glyph kerning — pdf.js sometimes splits
      // one visual word into multiple text-show operations with no
      // embedded space character between them.
      let out = "";
      let prevEnd: number | null = null;
      for (const it of sorted) {
        if (prevEnd !== null && it.x - prevEnd > 1.5 && !out.endsWith(" ") && !it.str.startsWith(" ")) out += " ";
        out += it.str;
        prevEnd = it.x + it.str.length * 4; // rough width estimate, good enough for gap detection
      }
      return out.replace(/\s+/g, " ").trim();
    })
    .join("\n");
}

// Real column widths top out around ~105pt; a genuine row's background
// band spans nearly the whole ~680pt table width — this floor cleanly
// separates the two kinds of rect this page draws.
const ROW_BAND_MIN_WIDTH = 400;
const ITEM_Y_TOLERANCE = 0.75;

// Extracts the raw 11-column table, one string array per row, across every
// page. Rows with fewer than 11 non-blank cells still come out as a full
// 11-element array (blank strings for unpopulated columns) — most rows
// have several blank trailing columns representing a genuinely open/
// unresolved challenge, not missing data (see README).
//
// Column assignment is keyed off each TEXT ITEM's own x-position against
// the header-derived column boundaries, not off a per-cell clip rect —
// confirmed via a live download that FDA's PDF only draws an individual
// clip rect for a cell whose content needs wrap-clipping; a short or empty
// cell gets no rect of its own at all. Keying column assignment to those
// rects (the original approach) meant a whole row's text fell through to
// whichever rect happened to cover it — usually the row's own full-width
// background rect, which resolves to column 0 and pulls in every other
// column's text with it. That background rect — confirmed present exactly
// once per row, with no gaps or duplicates, across pages 1, 2, 3, 50, and
// 96 of a live download — is kept on for exactly one job now: giving each
// row's y-band, which is the one thing per-cell rects can't be trusted to
// provide reliably.
async function extractRawRows(pdfBytes: Buffer): Promise<string[][]> {
  const doc = await loadDocument(pdfBytes);
  const page1 = await doc.getPage(1);
  const page1Items = await getPageItems(page1);
  const page1Rects = await getCellRects(page1);
  const headerItems = page1Items.filter((it) => it.y >= HEADER_BAND_Y_MIN && it.y < HEADER_BAND_Y_MAX);
  const columnBounds = deriveColumnBounds(headerItems);
  const dividerY = deriveHeaderBodyDividerY(page1Rects, headerItems);

  const rows: string[][] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = pageNum === 1 ? page1 : await doc.getPage(pageNum);
    const [items, rects] = await Promise.all([pageNum === 1 ? Promise.resolve(page1Items) : getPageItems(page), getCellRects(page)]);

    const rowBandRects = rects.filter(
      (r) => r.y2 <= dividerY + 0.5 && r.y1 >= 45 && r.y2 - r.y1 > 8 && r.y2 - r.y1 < 100 && r.x2 - r.x1 > ROW_BAND_MIN_WIDTH,
    );
    // Defensive de-dup keyed by y-band, keeping the widest rect per band —
    // in practice exactly one wide rect exists per row (confirmed above),
    // but this avoids double-emitting a row if that ever isn't true.
    const bandByKey = new Map<string, CellRect>();
    for (const r of rowBandRects) {
      const key = `${r.y1.toFixed(1)}_${r.y2.toFixed(1)}`;
      const existing = bandByKey.get(key);
      if (!existing || r.x2 - r.x1 > existing.x2 - existing.x1) bandByKey.set(key, r);
    }
    const orderedBands = [...bandByKey.values()].sort((a, b) => b.y2 - a.y2); // top to bottom

    for (const band of orderedBands) {
      const rowItems = items.filter((it) => it.y >= band.y1 - ITEM_Y_TOLERANCE && it.y <= band.y2 + ITEM_Y_TOLERANCE);
      const columnItems: TextItem[][] = Array.from({ length: NUM_COLUMNS }, () => []);
      for (const it of rowItems) {
        columnItems[colIndexForX(it.x, columnBounds)].push(it);
      }
      rows.push(columnItems.map((cellItems) => linesFromItems(cellItems)));
    }
  }
  return rows;
}

// ---- Cell-level parsing helpers -----------------------------------------

const MONTH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseMdyDate(text: string): Date | null {
  const m = MONTH_DATE.exec(text.trim());
  if (!m) return null;
  const [, month, day, year] = m;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

// Column 3: "RLD/NDA" cell. Confirmed real shapes (see README):
//   "Ziagen\n20977"              -> name "Ziagen", number "NDA020977"
//   "Bijuva\nNDA 210132"         -> "NDA " prefix on the last line
//   "Excedrin\n(migraine)\n20802" -> name wraps across multiple lines
//   "Pepcid"                     -> no number at all (~4.8% of rows)
function parseRldNda(raw: string): { name: string; ndaNumber: string | null; ndaNumberRaw: string | null } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { name: "", ndaNumber: null, ndaNumberRaw: null };

  const last = lines[lines.length - 1];
  const lastDigitsOnly = last.replace(/^(?:nda)\s*/i, "").trim();
  if (/^\d{3,7}$/.test(lastDigitsOnly)) {
    const name = lines.slice(0, -1).join(" ").trim() || last; // shouldn't be empty in practice, but never drop the row over it
    if (lastDigitsOnly.length > 6) {
      // A malformed/too-long number (confirmed real: one 7-digit case) —
      // keep the raw text for debugging, don't guess how to split it.
      return { name, ndaNumber: null, ndaNumberRaw: last };
    }
    return { name, ndaNumber: `NDA${lastDigitsOnly.padStart(6, "0")}`, ndaNumberRaw: null };
  }
  return { name: lines.join(" ").trim(), ndaNumber: null, ndaNumberRaw: null };
}

const PRE_MMA_PATTERN = /^pre-mma$/i;
const RECEIVED_PRIOR_PATTERN = /received\s*prior\s*to\s*([\d/]+)/i;

function parseSubmissionDate(raw: string): {
  type: ParsedChallenge["submissionDateType"];
  date: Date | null;
  issue: string | null;
} {
  const text = raw.replace(/\s+/g, " ").trim();
  if (PRE_MMA_PATTERN.test(text)) return { type: "PRE_MMA", date: null, issue: null };
  const priorMatch = RECEIVED_PRIOR_PATTERN.exec(text);
  if (priorMatch) {
    const date = parseMdyDate(priorMatch[1]);
    if (!date) return { type: "RECEIVED_PRIOR_TO", date: null, issue: `unparseable date in "received prior to" text: "${text}"` };
    return { type: "RECEIVED_PRIOR_TO", date, issue: null };
  }
  const date = parseMdyDate(text);
  if (!date) return { type: "EXACT_DATE", date: null, issue: `unrecognized Date of Submission value: "${text}"` };
  return { type: "EXACT_DATE", date, issue: null };
}

const STATUS_ALIASES: Record<string, PivDecisionStatus> = {
  eligible: "ELIGIBLE",
  deferred: "DEFERRED",
  "non-forfeiture": "NON_FORFEITURE",
  extinguished: "EXTINGUISHED",
};

// Column 6/7: 180-Day Status + Posting Date. Confirmed real shapes:
//   single value: "Eligible" / "2/11/2020"
//   stacked, most-recent-first (FDA's own stated ordering): "Extinguished\nEligible" / "1/12/2021\n2/11/2020"
//   ragged (status with no matching posting date — confirmed real, 5 rows): "Extinguished" / "" (empty)
//   per-strength-qualified text embedded in the status itself (confirmed real, 1 row):
//     "40 u/100 mL -\nExtinguished" — recognized status word extracted via lookup, full text kept as rawStatusText
function findStatusKeyword(text: string): PivDecisionStatus | null {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const found = Object.entries(STATUS_ALIASES).find(([key]) => normalized.includes(key));
  return found ? found[1] : null;
}

// A per-strength-qualified status (confirmed real, one row in the
// reference file: "40 u/100 mL -\nExtinguished") wraps its qualifier and
// the actual status word across two physical lines that are ONE logical
// entry, not two stacked decisions. Coalesces any line with no recognized
// status keyword into the following line before treating each result as
// one decisionHistory entry — a plain line has its own keyword and passes
// through unchanged; only a genuinely keyword-less line gets merged.
function coalesceStatusLines(lines: string[]): string[] {
  const result: string[] = [];
  let pending: string | null = null;
  for (const line of lines) {
    const combined: string = pending ? `${pending} ${line}` : line;
    if (findStatusKeyword(combined)) {
      result.push(combined);
      pending = null;
    } else {
      pending = combined; // keep accumulating — resolved on a later line, or flushed unresolved below
    }
  }
  if (pending) result.push(pending); // never drop trailing unrecognized text — surfaces as an ambiguous entry instead
  return result;
}

function parseDecisionHistory(
  statusRaw: string,
  postingRaw: string,
): { history: DecisionHistoryEntry[]; issue: string | null } {
  const rawStatusLines = statusRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawStatusLines.length === 0) return { history: [], issue: null };

  const statusEntries = coalesceStatusLines(rawStatusLines);
  const postingLines = postingRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let ambiguous = false;
  const history: DecisionHistoryEntry[] = statusEntries.map((line, i) => {
    const found = findStatusKeyword(line);
    if (!found) ambiguous = true;
    const postingText = postingLines[i];
    const postingDate = postingText ? parseMdyDate(postingText) : null;
    if (postingText && !postingDate) ambiguous = true;
    return {
      status: found ?? "ELIGIBLE", // placeholder only when unrecognized; ambiguous flag surfaces this
      rawStatusText: line,
      postingDate: postingDate ? postingDate.toISOString().slice(0, 10) : null,
    };
  });

  if (postingLines.length > statusEntries.length) ambiguous = true; // more dates than statuses — can't pair confidently

  return {
    history,
    issue: ambiguous
      ? `180-Day Status/Posting Date did not map cleanly (status: "${statusRaw}", posting: "${postingRaw}")`
      : null,
  };
}

// Columns 9/10 (commercial marketing date) and 10... wait column indices:
// firstCommercialMarketing and expirationLastQualifyingPatent can both
// carry multiple strength-qualified values in one cell. Confirmed real
// shapes are genuinely inconsistent (separator "-" vs ":", strength
// before OR after the date) — see README. This only ever attempts the
// single-value common case; anything with more than one date token is
// left unparsed (raw text preserved, RowIssue logged) rather than guessed.
const DATE_TOKEN = /\d{1,2}\/\d{1,2}\/\d{4}/g;

function parseSingleOrFlagMultiValue(raw: string, fieldLabel: string): { date: Date | null; issue: string | null } {
  const text = raw.trim();
  if (!text) return { date: null, issue: null };
  const dateTokens = text.match(DATE_TOKEN) ?? [];
  if (dateTokens.length === 0) return { date: null, issue: `unrecognized ${fieldLabel} value: "${text}"` };
  if (dateTokens.length === 1) return { date: parseMdyDate(dateTokens[0]), issue: null };
  return {
    date: null,
    issue: `${fieldLabel} has multiple values that could not be unambiguously split by strength ("${text.replace(/\n/g, " | ")}") — see rawNotes`,
  };
}

function parseIntOrNull(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

// ---- Row -> ParsedChallenge ----------------------------------------------

// Exported for testing: this is where all the edge-case handling (Pre-MMA,
// received-prior-to, ragged multi-value status/posting-date pairing,
// no-RLD/NDA-number rows, per-strength-qualified status text, ambiguous
// multi-value marketing/expiration dates) actually lives, and it operates
// on plain string columns — no PDF geometry needed to exercise it, unlike
// the row-extraction layer above.
export function rowToChallenge(cols: Record<ColumnKey, string>, rowIndex: number, issues: RowIssue[]): ParsedChallenge | null {
  const activeIngredient = cols.activeIngredient.replace(/\n/g, " ").trim();
  const dosageForm = cols.dosageForm.replace(/\n/g, " ").trim();
  if (!activeIngredient || !dosageForm) {
    issues.push({ file: "piv-list.pdf", line: rowIndex, reason: "missing active ingredient or dosage form", raw: JSON.stringify(cols) });
    return null;
  }

  const { name: rldName, ndaNumber, ndaNumberRaw } = parseRldNda(cols.rldNda);
  if (!ndaNumber) {
    issues.push({
      file: "piv-list.pdf",
      line: rowIndex,
      reason: ndaNumberRaw ? `RLD/NDA number did not normalize cleanly: "${ndaNumberRaw}"` : "no RLD/NDA number in source data",
      raw: cols.rldNda,
    });
  }

  const submission = parseSubmissionDate(cols.dateOfSubmission);
  if (submission.issue) issues.push({ file: "piv-list.pdf", line: rowIndex, reason: submission.issue, raw: cols.dateOfSubmission });

  const { history, issue: historyIssue } = parseDecisionHistory(cols.status180Day, cols.posting180Day);
  if (historyIssue) issues.push({ file: "piv-list.pdf", line: rowIndex, reason: historyIssue, raw: `${cols.status180Day} | ${cols.posting180Day}` });

  const marketing = parseSingleOrFlagMultiValue(cols.firstCommercialMarketing, "Date of First Commercial Marketing");
  if (marketing.issue) issues.push({ file: "piv-list.pdf", line: rowIndex, reason: marketing.issue, raw: cols.firstCommercialMarketing });

  const expiration = parseSingleOrFlagMultiValue(cols.expirationLastQualifyingPatent, "Expiration Date of Last Qualifying Patent");
  if (expiration.issue) issues.push({ file: "piv-list.pdf", line: rowIndex, reason: expiration.issue, raw: cols.expirationLastQualifyingPatent });

  const rawNotesParts = [marketing.issue ? `firstCommercialMarketing raw: "${cols.firstCommercialMarketing}"` : null, expiration.issue ? `expirationLastQualifyingPatent raw: "${cols.expirationLastQualifyingPatent}"` : null].filter((x): x is string => x !== null);

  return {
    activeIngredient,
    dosageForm,
    strength: cols.strength.replace(/\n/g, " ").trim(),
    rldName,
    rldNdaNumber: ndaNumber,
    rldNdaNumberRaw: ndaNumberRaw,
    submissionDateType: submission.type,
    submissionDate: submission.date,
    potentialFirstApplicantAndaCount: parseIntOrNull(cols.numberOfAndas),
    decisionHistory: history,
    currentStatus: history[0]?.status ?? null,
    dateOfFirstApplicantApproval: parseMdyDate(cols.firstApplicantApproval.replace(/\n/g, " ").trim()),
    dateOfFirstCommercialMarketing: marketing.date,
    expirationOfLastQualifyingPatent: expiration.date,
    rawStrengthText: cols.strength,
    rawNotes: rawNotesParts.length > 0 ? rawNotesParts.join("; ") : null,
  };
}

export async function parseParagraphIVPdf(pdfBytes: Buffer): Promise<ParseResult> {
  const rawRows = await extractRawRows(pdfBytes);
  const issues: RowIssue[] = [];
  const challenges: ParsedChallenge[] = [];

  rawRows.forEach((cells, i) => {
    const cols = Object.fromEntries(COLUMN_KEYS.map((key, idx) => [key, cells[idx] ?? ""])) as Record<ColumnKey, string>;
    try {
      const challenge = rowToChallenge(cols, i + 1, issues);
      if (challenge) challenges.push(challenge);
    } catch (error) {
      issues.push({
        file: "piv-list.pdf",
        line: i + 1,
        reason: `unexpected parse error: ${error instanceof Error ? error.message : String(error)}`,
        raw: JSON.stringify(cells),
      });
    }
  });

  return { challenges, issues, rawCount: rawRows.length };
}
