import { describe, expect, it } from "vitest";
import { parsePatentListHtml } from "@/lib/ingestion/purpleBook/parsePatentList";

// A minimal but structurally real fragment of the server-rendered
// /patent-list page — verified directly against the live page that this is
// what a plain GET actually returns (a fully server-rendered <table>, not
// a paginated slice; DataTables loads the whole thing into memory at init
// and only re-renders the DOM to show one page, but the raw HTML has every
// row before that JS ever runs). See parsePatentList.ts for the full
// rationale on why this is scraped rather than a downloadable file (none
// exists for patent data).
function buildHtml(rows: string): string {
  return `
    <html><body>
    <table id="patentListTable" class="table">
      <thead><tr><th>Reference Product BLA Number</th><th>Applicant Name</th><th>Proprietary Name</th><th>Proper Name</th><th>Patent Number</th><th>Patent Expiration Date</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </body></html>
  `;
}

const REAL_ROW = `
  <tr valign="top" >
    <td>103705</td>
    <td>Genentech, Inc.</td>
    <td><a href="index.cfm?event=productdetails&blaNo=103705" >Rituxan</a></td>
    <td>rituximab</td>
    <td>

    8,512,983

    </td>
    <td>January 4, 2031</td>
  </tr>
`;

describe("parsePatentListHtml", () => {
  it("parses a real row, stripping HTML tags/whitespace and comma-punctuation from the patent number", () => {
    const { patents, issues } = parsePatentListHtml(buildHtml(REAL_ROW));
    expect(issues).toHaveLength(0);
    expect(patents).toEqual([
      { blaNumber: "103705", patentNumber: "8512983", sourceExpirationDate: new Date("2031-01-04") },
    ]);
  });

  it("unescapes HTML entities (e.g. &amp; in the applicant link href) without leaking them into parsed values", () => {
    const row = REAL_ROW.replace("blaNo=103705", "blaNo=103705&amp;foo=bar");
    const { patents } = parsePatentListHtml(buildHtml(row));
    expect(patents[0].patentNumber).toBe("8512983");
  });

  it("returns an empty result with a logged issue if the table markup isn't found (defensive against a page redesign)", () => {
    const { patents, issues } = parsePatentListHtml("<html><body>no table here</body></html>");
    expect(patents).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toContain("patentListTable");
  });

  it("skips a row with the wrong number of cells and logs why, without crashing", () => {
    const malformed = `<tr valign="top" ><td>103705</td><td>Genentech</td></tr>`;
    const { patents, issues } = parsePatentListHtml(buildHtml(malformed));
    expect(patents).toHaveLength(0);
    expect(issues[0].reason).toContain("expected 6 cells");
  });

  it("skips a row with an unparseable expiration date and logs why", () => {
    const bad = REAL_ROW.replace("January 4, 2031", "not a date");
    const { patents, issues } = parsePatentListHtml(buildHtml(bad));
    expect(patents).toHaveLength(0);
    expect(issues.some((i) => i.reason.includes("unparseable"))).toBe(true);
  });

  it("parses multiple rows for the same BLA number independently", () => {
    const second = REAL_ROW.replace("8,512,983", "7,976,838").replace("January 4, 2031", "June 30, 2025");
    const { patents } = parsePatentListHtml(buildHtml(REAL_ROW + second));
    expect(patents).toHaveLength(2);
    expect(patents.map((p) => p.patentNumber)).toEqual(["8512983", "7976838"]);
  });
});
