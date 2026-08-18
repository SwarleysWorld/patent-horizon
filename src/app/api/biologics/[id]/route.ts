import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, internalErrorResponse, unauthorizedResponse } from "@/lib/api/errors";
import { getBiologicById } from "@/lib/drugs/queries";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const { id } = await params;

  try {
    const biologic = await getBiologicById(id);
    if (!biologic) return notFoundResponse(`No biologic product found with id "${id}".`);
    return NextResponse.json({ data: biologic });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
