// FDA's Paragraph IV list PDF is published under a `/media/<id>/download`
// URL whose numeric id changes whenever FDA republishes the file — the URL
// given to us (`/media/166048/download`) is a snapshot, not a permanent
// constant. So this fetches the PARENT page first and scrapes out
// whichever download link is currently live, the same way a person would
// find it by hand, rather than hardcoding today's id.
//
// Both this page and the PDF itself sit behind a WAF that blocks
// non-browser User-Agents (confirmed directly — a bare `curl`/`fetch`
// without one 404s; the same header block already used for Purple Book's
// WAF works here too).
const PARENT_PAGE_URL =
  "https://www.fda.gov/drugs/abbreviated-new-drug-application-anda/patent-certifications-and-suitability-petitions";

const BROWSER_LIKE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/pdf,*/*",
};

// The parent page also links a handful of OTHER `/media/<id>/download`
// PDFs that are not the list we want (the "180-Day Exclusivity: Questions
// and Answers" guidance doc, two old suitability-petition tracking
// reports). Matching on the *link text itself* — which FDA phrases as
// "Paragraph IV Patent Certifications (PPIV) as of <date>" — is far more
// specific than scanning nearby prose (the whole page says "Paragraph IV"
// constantly). The link's `title` attribute ("New Paragraph IV
// Certifications") is checked too as a fallback, in case FDA tweaks the
// visible link text's exact wording in a future update but keeps the
// title, or vice versa.
const LINK_REGEX = /<a\s+href="(\/media\/\d+\/download[^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi;
const RELEVANT_TEXT_PATTERN = /paragraph\s*iv.*certif/i;

export interface ParagraphIVSourceLink {
  url: string;
  linkText: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function findParagraphIVPdfLink(parentPageHtml: string): ParagraphIVSourceLink | null {
  const candidates: ParagraphIVSourceLink[] = [];
  for (const match of parentPageHtml.matchAll(LINK_REGEX)) {
    const [, href, attrs, innerHtml] = match;
    const linkText = stripTags(innerHtml);
    const titleAttrMatch = attrs.match(/title="([^"]*)"/i);
    const titleAttr = titleAttrMatch ? titleAttrMatch[1] : "";
    if (RELEVANT_TEXT_PATTERN.test(linkText) || RELEVANT_TEXT_PATTERN.test(titleAttr)) {
      candidates.push({ url: new URL(href, PARENT_PAGE_URL).toString(), linkText: linkText || titleAttr });
    }
  }
  // If more than one link matches (shouldn't happen, but don't silently
  // pick an arbitrary one if it does), prefer the first — the page's own
  // reading order puts the current list first.
  return candidates[0] ?? null;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_LIKE_HEADERS });
  if (!res.ok) throw new Error(`failed to fetch ${url}: HTTP ${res.status}`);
  return res.text();
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: BROWSER_LIKE_HEADERS });
  if (!res.ok) throw new Error(`failed to fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface FetchedParagraphIVSource {
  pdfUrl: string;
  linkText: string;
  pdfBytes: Buffer;
}

export async function fetchParagraphIVPdf(opts: { explicitPdfUrl?: string } = {}): Promise<FetchedParagraphIVSource> {
  if (opts.explicitPdfUrl) {
    const pdfBytes = await fetchBinary(opts.explicitPdfUrl);
    return { pdfUrl: opts.explicitPdfUrl, linkText: "(explicit URL)", pdfBytes };
  }

  const parentHtml = await fetchText(PARENT_PAGE_URL);
  const link = findParagraphIVPdfLink(parentHtml);
  if (!link) {
    throw new Error(
      `could not find a "Paragraph IV Patent Certifications" PDF link on ${PARENT_PAGE_URL} — FDA may have restructured the page; pass --url explicitly`,
    );
  }
  const pdfBytes = await fetchBinary(link.url);
  return { pdfUrl: link.url, linkText: link.linkText, pdfBytes };
}
