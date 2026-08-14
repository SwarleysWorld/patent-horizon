import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/lib/openapi/spec";

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument("http://localhost:3000");

  it("is a valid-shaped OpenAPI 3.1 document", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Patent Horizon API");
  });

  it("documents all drug endpoints", () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/drugs", "/api/drugs/{id}", "/api/drugs/filter-options"]),
    );
  });

  it("lists every ListDrugsQuery param with a schema", () => {
    const params = doc.paths["/api/drugs"].get.parameters;
    const names = params.map((p) => p.name);
    expect(names).toEqual([
      "q",
      "withinDays",
      "expiresAfter",
      "expiresBefore",
      "modality",
      "drugClass",
      "applicationType",
      "dosageForm",
      "sort",
      "limit",
      "offset",
    ]);
    for (const p of params) {
      expect(p.schema).toBeTypeOf("object");
    }
  });

  it("marks limit/offset/sort as not required (they have defaults) and q as optional", () => {
    const params = doc.paths["/api/drugs"].get.parameters;
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName.q.required).toBe(false);
    expect(byName.limit.required).toBe(false);
    expect(byName.sort.required).toBe(false);
  });

  it("declares 400/404/500 error responses with the shared error schema", () => {
    const listErrors = doc.paths["/api/drugs"].get.responses;
    expect(listErrors["400"].content["application/json"].schema).toBeDefined();
    const detailErrors = doc.paths["/api/drugs/{id}"].get.responses;
    expect(detailErrors["404"].content["application/json"].schema).toBeDefined();
  });

  it("never omits the $schema stripping — no stray $schema keys leak into the doc", () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('"$schema"');
  });
});
