import { z } from "zod";
import {
  ListDrugsQuerySchema,
  ListDrugsResponseSchema,
  DrugDetailResponseSchema,
  FilterOptionsSchema,
} from "@/lib/drugs/schemas";
import { ApiErrorSchema } from "@/lib/api/errors";

// The OpenAPI document is generated from the same Zod schemas that
// validate requests and shape responses (src/lib/drugs/schemas.ts,
// src/lib/api/errors.ts) — there is exactly one place that defines what
// the API accepts and returns. Nothing here is hand-duplicated, so the
// docs can't silently drift from what the routes actually do.

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const result = z.toJSONSchema(schema) as Record<string, unknown>;
  delete result.$schema; // OpenAPI schema objects don't carry a top-level $schema key
  return result;
}

function queryParamsFrom(schema: z.ZodObject<z.ZodRawShape>) {
  return Object.entries(schema.shape).map(([name, fieldSchema]) => ({
    name,
    in: "query",
    required: !(fieldSchema as z.ZodType).isOptional(),
    schema: jsonSchema(fieldSchema as z.ZodType),
  }));
}

const errorResponseObject = {
  description: "Error response",
  content: { "application/json": { schema: jsonSchema(ApiErrorSchema) } },
};

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Patent Horizon API",
      version: "1.0.0",
      description:
        "Tracks pharmaceutical patent expirations and estimates when generic market entry becomes possible.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/drugs": {
        get: {
          summary: "List / search drugs, ranked by soonest estimated generic entry",
          description:
            "The core \"what's expiring soon\" view. Every returned drug includes " +
            "`estimatedGenericEntryDate`, computed as the latest-expiring currently-listed " +
            "patent or exclusivity for that drug. Sorted soonest-first by default.",
          parameters: queryParamsFrom(ListDrugsQuerySchema),
          responses: {
            "200": {
              description: "A page of matching drugs.",
              content: { "application/json": { schema: jsonSchema(ListDrugsResponseSchema) } },
            },
            "400": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/drugs/{id}": {
        get: {
          summary: "Get full detail for one drug",
          description:
            "Returns every patent and exclusivity on file for the drug, plus " +
            "`genericEntryEstimate`: the best current estimate of when generic entry " +
            "becomes possible, with the specific controlling patent or exclusivity named.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The drug's internal id, as returned by GET /api/drugs.",
            },
          ],
          responses: {
            "200": {
              description: "The drug's full detail.",
              content: { "application/json": { schema: jsonSchema(DrugDetailResponseSchema) } },
            },
            "404": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/drugs/filter-options": {
        get: {
          summary: "Advanced search filter vocabulary",
          description:
            "The current set of values for each advanced-search filter: the fixed " +
            "modality/applicationType enums (every possible value, even ones with zero " +
            "current matches), the fixed drugClass label set, and the dosageForm values " +
            "actually present in the data (open-ended free text, so this list reflects reality " +
            "rather than a hardcoded guess).",
          responses: {
            "200": {
              description: "Filter option vocabulary.",
              content: { "application/json": { schema: jsonSchema(z.object({ data: FilterOptionsSchema })) } },
            },
            "500": errorResponseObject,
          },
        },
      },
      "/api/health": {
        get: {
          summary: "Database connectivity check",
          responses: {
            "200": { description: "Database reachable." },
            "503": { description: "Database unreachable." },
          },
        },
      },
    },
  };
}
