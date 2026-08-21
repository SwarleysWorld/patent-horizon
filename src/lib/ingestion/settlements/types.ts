export interface RowIssue {
  file: string;
  line: number; // always -1 here — no row/line concept for a filing-text extraction, kept only for shape parity with the other pipelines' RowIssue and their shared categorizeIssues() pattern
  reason: string;
  raw: unknown;
}
