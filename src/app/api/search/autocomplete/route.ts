import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/api/parseQuery";
import { validationErrorResponse, internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { AutocompleteQuerySchema } from "@/lib/drugs/schemas";
import { autocomplete } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const parsed = parseQuery(AutocompleteQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const data = await autocomplete(parsed.data.q, parsed.data.limit);
    return NextResponse.json({ data });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
