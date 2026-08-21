import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, internalErrorResponse, unauthorizedResponse, validationErrorResponse } from "@/lib/api/errors";
import { getDrugById } from "@/lib/drugs/queries";
import { DrugIdParamSchema } from "@/lib/drugs/schemas";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const parsed = DrugIdParamSchema.safeParse(await params);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { id } = parsed.data;

  try {
    const drug = await getDrugById(id);
    if (!drug) return notFoundResponse(`No drug found with id "${id}".`);
    return NextResponse.json({ data: drug });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
