import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    // Unauthenticated endpoint — never leak raw error internals (connection
    // strings, SQL, stack traces) to the caller. Log server-side instead.
    console.error(error);
    return NextResponse.json({ status: "error", database: "disconnected" }, { status: 503 });
  }
}
