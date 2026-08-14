import { NextRequest, NextResponse } from "next/server";
import { internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { getFilterOptions } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  try {
    const data = await getFilterOptions();
    return NextResponse.json({ data });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
