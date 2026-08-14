import { NextRequest, NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/openapi/spec";

export async function GET(request: NextRequest) {
  const doc = buildOpenApiDocument(request.nextUrl.origin);
  return NextResponse.json(doc);
}
