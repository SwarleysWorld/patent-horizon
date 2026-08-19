import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/api/parseQuery";
import { validationErrorResponse, internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";
import { listDrugs } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";
import { MODALITY_LABELS, type Modality } from "@/lib/classification/modality";

// Larger than the entire current combined dataset (~50,700 rows as of
// writing), so this is effectively "everything matching the filters"
// today — a safety cap, not a real-world limit, so a future data-volume
// increase can't turn this into an accidental full-table dump.
const EXPORT_ROW_CAP = 50_000;

const CSV_COLUMNS = [
  "source",
  "name",
  "alternateName",
  "applicant",
  "type",
  "dosageForm",
  "route",
  "strength",
  "modality",
  "drugClass",
  "estimatedGenericEntryDate",
  "dateConfidence",
  "patentCount",
  "exclusivityCount",
  "maxPtaGapDays",
] as const;

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Spelled out rather than the raw enum value — this CSV is a real export
// surface handed to colleagues/clients, and "pending_verification" reads
// as a code, not a fact, to someone who never saw the app's UI.
const DATE_CONFIDENCE_LABELS: Record<string, string> = {
  confirmed: "Verified",
  pending_verification: "Pending USPTO verification",
};

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const parsed = parseQuery(ListDrugsQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    // The export is "everything matching these filters," not one page of
    // them — limit/offset from the request are deliberately overridden
    // here rather than validated against the schema's normal 1-100 cap,
    // which exists for the paginated list view, not this endpoint.
    const result = await listDrugs({ ...parsed.data, limit: EXPORT_ROW_CAP, offset: 0 });

    const lines = [CSV_COLUMNS.join(",")];
    for (const row of result.data) {
      const values = [
        row.source,
        row.name,
        row.alternateName,
        row.company.name,
        row.applicationType ?? row.licenseType ?? "",
        row.dosageForm,
        row.route,
        row.strength,
        MODALITY_LABELS[row.modality as Modality],
        row.drugClass ?? "",
        row.estimatedGenericEntryDate ?? "",
        row.dateConfidence ? DATE_CONFIDENCE_LABELS[row.dateConfidence] : "",
        String(row.patentCount),
        String(row.exclusivityCount),
        row.maxPtaGapDays != null ? String(row.maxPtaGapDays) : "",
      ];
      lines.push(values.map((v) => csvEscape(v)).join(","));
    }

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="patent-horizon-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
