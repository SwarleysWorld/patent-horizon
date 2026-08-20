import { z } from "zod";
import {
  ListDrugsQuerySchema,
  ListDrugsResponseSchema,
  DrugDetailResponseSchema,
  BiologicDetailResponseSchema,
  FilterOptionsSchema,
  AutocompleteQuerySchema,
  AutocompleteResponseSchema,
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
          summary: "List / search across both Orange Book drugs and Purple Book biologics, ranked by soonest estimated generic entry",
          description:
            "The core \"what's expiring soon\" view — spans both small-molecule drugs (FDA Orange Book) " +
            "and biologics (FDA Purple Book) in one ranked, paginated result set. Every result includes " +
            "`estimatedGenericEntryDate` (the latest-expiring currently-listed patent or exclusivity) and " +
            "`source` (`orange_book` or `purple_book`) so a caller can tell which detail endpoint to follow " +
            "(`/api/drugs/{id}` or `/api/biologics/{id}`). Filters combine with AND across categories, OR " +
            "within a comma-separated one. Sorted soonest-first by default; `sort=pta_gap_desc` surfaces the " +
            "biggest USPTO Patent Term Adjustment corrections first. The response also includes `facets`: " +
            "result counts per value for the main filter dimensions, scoped by every other active filter.",
          parameters: queryParamsFrom(ListDrugsQuerySchema),
          responses: {
            "200": {
              description: "A page of matching results plus facet counts.",
              content: { "application/json": { schema: jsonSchema(ListDrugsResponseSchema) } },
            },
            "400": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/drugs/{id}": {
        get: {
          summary: "Get full detail for one Orange Book drug",
          description:
            "Returns every patent and exclusivity on file for the drug, plus " +
            "`genericEntryEstimate`: the best current estimate of when generic entry " +
            "becomes possible, with the specific controlling patent or exclusivity named. " +
            "For a biologic (`source: \"purple_book\"` in a /api/drugs search result), use " +
            "GET /api/biologics/{id} instead — the two product types have different detail shapes.",
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
      "/api/biologics/{id}": {
        get: {
          summary: "Get full detail for one Purple Book biologic product",
          description:
            "Same idea as GET /api/drugs/{id}, for biologics: every patent and exclusivity on file, plus " +
            "`genericEntryEstimate`. Also includes the BPCIA biosimilar/interchangeable/reference-product " +
            "network — `referenceProduct` (resolved, if a match was found), `referenceProductNameRaw` (the " +
            "source's raw name when it couldn't be resolved), and `biosimilarsAndInterchangeables` (products " +
            "that reference this one).",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The biologic product's internal id, as returned by GET /api/drugs.",
            },
          ],
          responses: {
            "200": {
              description: "The biologic product's full detail.",
              content: { "application/json": { schema: jsonSchema(BiologicDetailResponseSchema) } },
            },
            "404": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/search/autocomplete": {
        get: {
          summary: "Name autocomplete across both sources",
          description:
            "Trigram-similarity name matching (Postgres pg_trgm) across brand/proprietary names in both " +
            "sources — typo-tolerant prefix/substring matching, not a paginated search; returns a small, " +
            "ranked list meant for a live-typing dropdown.",
          parameters: queryParamsFrom(AutocompleteQuerySchema),
          responses: {
            "200": {
              description: "Ranked name matches.",
              content: { "application/json": { schema: jsonSchema(AutocompleteResponseSchema) } },
            },
            "400": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/drugs/export": {
        get: {
          summary: "Export the current filtered results as CSV",
          description:
            "Accepts the exact same filters as GET /api/drugs (everything except `limit`/`offset`, which " +
            "are overridden internally — this returns up to the top 500 matching rows, not one page) and " +
            "streams a CSV file with a Content-Disposition attachment header. The response also carries " +
            "X-Export-Row-Cap and X-Export-Total-Matches headers, so a caller can detect truncation when " +
            "the filtered result set exceeds 500 rows.",
          parameters: queryParamsFrom(ListDrugsQuerySchema),
          responses: {
            "200": {
              description: "CSV file.",
              content: { "text/csv": { schema: { type: "string" } } },
            },
            "400": errorResponseObject,
            "500": errorResponseObject,
          },
        },
      },
      "/api/drugs/filter-options": {
        get: {
          summary: "Advanced search filter vocabulary",
          description:
            "The current set of values for each advanced-search filter: fixed vocabularies " +
            "(modality, applicationType, source, patentType — every possible value, even ones with " +
            "zero current matches) and the fixed drugClass label set, plus the dosageForm/route/" +
            "applicant/exclusivityCode values actually present in the data (open-ended free text, " +
            "combined across both sources, so these reflect reality rather than a hardcoded guess).",
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
