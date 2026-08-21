import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, internalErrorResponse, unauthorizedResponse, validationErrorResponse } from "@/lib/api/errors";
import { getBiologicById } from "@/lib/drugs/queries";
import { DrugIdParamSchema } from "@/lib/drugs/schemas";
import { getSessionUser } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(request);
  if (!user) return unauthorizedResponse();

  const parsed = DrugIdParamSchema.safeParse(await params);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const { id } = parsed.data;

  try {
    const biologic = await getBiologicById(id);
    if (!biologic) return notFoundResponse(`No biologic product found with id "${id}".`);
    return NextResponse.json({ data: biologic });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
