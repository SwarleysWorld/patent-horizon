import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { getDrugById } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const { id } = await params;

  try {
    const drug = await getDrugById(id);
    if (!drug) return notFoundResponse(`No drug found with id "${id}".`);
    return NextResponse.json({ data: drug });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
