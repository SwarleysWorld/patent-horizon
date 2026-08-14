import type { ZodType, z } from "zod";

// Zod's object schemas expect a plain object, but URLSearchParams is an
// iterable of [key, value] pairs (and repeats keys for arrays). This
// covers the single-value query params this API uses; multi-value params
// would need `getAll`, which none of the current endpoints need.
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export type ParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

export function parseQuery<S extends ZodType>(schema: S, params: URLSearchParams): ParseResult<z.infer<S>> {
  const result = schema.safeParse(searchParamsToObject(params));
  if (!result.success) return { success: false, error: result.error };
  return { success: true, data: result.data };
}
