import { NextResponse } from "next/server";
import { z, type ZodError } from "zod";

// Every error response uses this envelope, regardless of endpoint. A
// consistent shape means a frontend (or any other consumer) can write one
// error-handling path instead of one per route. Defined as a Zod schema
// (not just a TS type) so it can feed the OpenAPI doc from the same
// source of truth as everything else.
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(["VALIDATION_ERROR", "NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN", "CONFLICT", "INTERNAL_ERROR"]),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export function validationErrorResponse(zodError: ZodError): NextResponse<ApiErrorBody> {
  const details = zodError.issues.map((issue) => ({
    field: issue.path.join(".") || "(query)",
    message: issue.message,
  }));
  return NextResponse.json(
    {
      error: {
        code: "VALIDATION_ERROR" as const,
        message: "One or more query parameters are invalid.",
        details,
      },
    },
    { status: 400 },
  );
}

export function notFoundResponse(message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: "NOT_FOUND" as const, message } },
    { status: 404 },
  );
}

export function unauthorizedResponse(
  message = "Sign in to access this resource.",
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED" as const, message } },
    { status: 401 },
  );
}

export function forbiddenResponse(
  message = "You don't have permission to access this resource.",
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: "FORBIDDEN" as const, message } },
    { status: 403 },
  );
}

export function conflictResponse(message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: "CONFLICT" as const, message } },
    { status: 409 },
  );
}

export function internalErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  // Never leak raw error internals (stack traces, SQL, connection strings)
  // to the client — log server-side, return a generic message.
  console.error(error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR" as const, message: "Something went wrong processing this request." } },
    { status: 500 },
  );
}
