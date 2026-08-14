import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/api/parseQuery";
import { validationErrorResponse, internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { ListDrugsQuerySchema } from "@/lib/drugs/schemas";
import { listDrugs } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const parsed = parseQuery(ListDrugsQuerySchema, request.nextUrl.searchParams);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const result = await listDrugs(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return internalErrorResponse(error);
  }
}
