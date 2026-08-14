# Patent Horizon

Tracks pharmaceutical patent expirations and tells generic drug manufacturers
when it's time to move.

## Stack

Chosen for one goal: a solo founder (plus a coding agent) shipping an MVP fast,
without fighting the tools.

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language for UI, API, and DB layer. No context-switching, no serialization mismatches. |
| Framework | [Next.js](https://nextjs.org) (App Router) | Frontend + backend in one project. File-based routing, API routes (`route.ts`) instead of a separate server. Huge ecosystem, huge amount of training data for coding agents, so it's a framework Claude can work in reliably across sessions. |
| Styling | [Tailwind CSS](https://tailwindcss.com) | No design system to build from scratch. Fast to iterate, easy for an agent to apply consistently. |
| Database | [PostgreSQL](https://www.postgresql.org) | The default boring choice for relational data (patents, expiration dates, holders, filings). Every managed host supports it. |
| ORM | [Prisma](https://www.prisma.io) (v7) | Type-safe queries generated from a schema file that doubles as documentation. Migrations are tracked in `prisma/migrations` and safe to run in CI/CD. |

Nothing exotic: no microservices, no GraphQL, no separate backend repo. One
Next.js app, one Postgres database.

### Why this over the alternatives

- **Vs. a separate backend (Express/FastAPI) + separate frontend (React/Vue):**
  more moving parts, two deploy targets, two languages to keep in sync for no
  benefit at this scale. Next.js API routes are enough for an MVP.
- **Vs. SQLite:** patent data is relational and will grow (patents, filings,
  companies, users, alerts). Postgres avoids a migration later and every
  serious host (Vercel, Railway, Render, Fly, Neon, Supabase) offers it
  as a managed service, so "easy to deploy" isn't sacrificed.
- **Vs. an ORM-less / raw SQL setup:** Prisma's schema file is a single
  source of truth a coding agent can read to understand the entire data
  model in seconds, and its generated types catch mistakes at compile time.

## Data model

`prisma/schema.prisma` is the source of truth; this section explains the
non-obvious decisions.

**Entities:** `Company` → `Drug` (one approved product: brand/generic name +
dosage form + route + strength under one FDA application) → `Patent` and
`Exclusivity` (both belong to a `Drug`). `DataSource` + `IngestionRecord`
track provenance across all three.

### Grain of `Drug`: one row per product, not per application

An FDA application (NDA/ANDA/BLA) can cover several strengths or dosage
forms, each with potentially different patents and exclusivities. `Drug`
is deliberately grained at the *product* level (`applicationNumber` +
`productNumber`) rather than the application level, mirroring the FDA
Orange Book's own "Products" file row-for-row. Ingestion becomes a near-
literal mapping from source rows to `Drug` rows instead of an application
that needs to be split apart later.

### Nominal vs. effective patent expiry

This is the field pair you specifically asked about, on `Patent`:

- **`nominalExpiryDate`** — the legally listed / face-value expiry: what's
  printed on the patent or originally listed by a source, before any
  adjustment is applied.
- **`effectiveExpiryDate`** — our best-known *actual* enforceable expiry,
  after Patent Term Adjustment (extra days for USPTO prosecution delay),
  Patent Term Extension (extra time for regulatory review delay, Hatch-
  Waxman), and terminal disclaimers (which can *shorten* a term to match
  another patent) are factored in.
- **`expiryAdjustmentDays`** — signed day delta between the two. `NULL`
  means "we haven't confirmed the adjustment yet"; `0` means "confirmed,
  there is no adjustment." That distinction matters for a staleness/
  confidence view later — a patent stuck at `NULL` is a known gap, a
  patent at `0` has been checked and genuinely has none.

**Why store both instead of just the one that matters (`effective`):**
the entire product pitch is "we tell you the *real* date, not the naive
one" — so the UI needs to show both and explain the gap (e.g. "listed as
expiring 2010-03-24; with 184 days of Patent Term Adjustment, effectively
expires 2010-09-24"). Storing only `effectiveExpiryDate` would make that
transparency impossible and would also collapse two facts that can come
from *different sources* (a registry's listed date vs. a USPTO term
calculation) into one field, hiding disagreement between them.

**Why not compute `effective` on the fly instead of storing it:** PTA/PTE
figures come from an external determination (USPTO), not from a formula
Patent Horizon can always derive itself from `filingDate` alone (grant-
date delays, examiner-specific facts, and disclaimers aren't reconstructible
from filing date + patent number). It has to be ingested as a fact, so it
needs a column.

**Tradeoff I made explicitly:** `effectiveExpiryDate` is `NOT NULL`. The
ingestion convention should be: if the adjustment isn't known yet, set
`effectiveExpiryDate = nominalExpiryDate` and leave `expiryAdjustmentDays`
`NULL`. The alternative — making `effectiveExpiryDate` nullable — would be
more "honest" about unknowns, but it pushes a null-check into every query
that computes "when can a generic enter," which is the app's core purpose
and should never have to handle a missing date. If that tradeoff feels
wrong once ingestion is built, it's a one-column nullability change, not a
redesign.

**Why `Exclusivity` has no nominal/effective split:** FDA exclusivities are
granted with one fixed expiration date; there's no USPTO-style adjustment
process layered on afterward. Pediatric exclusivity (+6 months) is granted
as its own line item with its own date rather than mutating an existing
one, so the asymmetry with `Patent` reflects a real asymmetry in how the
two legal mechanisms work, not an oversight.

### `coversDrugSubstance` / `coversDrugProduct` booleans, not a `patentType` enum

A single patent can cover both the drug substance (the compound) and the
drug product (the formulation) at once — the Orange Book represents this
as two independent flags, not a category. Modeling it as one `patentType`
enum would have forced a lossy either/or choice; the booleans mirror the
source directly and stay accurate when ingesting from it. `useCode` is a
free-text field, `NULL` unless the row is a method-of-use listing.

### Patents upsert in place; exclusivities don't

`Patent`'s unique key is `(drugId, patentNumber, useCode)` — it does *not*
include the expiry dates. That's intentional: when a later ingestion run
corrects a PTA figure for the same patent, it should update the existing
row, not create a duplicate. `Exclusivity`'s unique key is `(drugId, code,
expirationDate)` — the date *is* part of the key, because a changed date
for FDA purposes represents a new determination, not a correction to an
old one, and this matches the natural key of the source data exactly
(making upserts a direct 1:1 mapping from source rows).

### Exclusivity `code` is a raw string, not an enum

FDA's exclusivity code vocabulary (NCE, ODE-*, PED, GAIN, NPP, ...) is
larger than the handful of well-known types and keeps growing. A rigid
enum would mean ingestion breaks — or silently drops data — every time a
source returns a code that hasn't been added yet. `code` stores whatever
the source says verbatim; `description` is an optional human-readable
gloss added at the application layer. `ApplicationType` (NDA/ANDA/BLA), by
contrast, *is* an enum — that vocabulary is fixed by statute and won't
change.

### Provenance: an append-only log, not a `lastVerifiedAt` column

`IngestionRecord` is a separate table with a row per ingestion/verification
event, linked to exactly one `Drug`, `Patent`, or `Exclusivity` (enforced
by a `CHECK` constraint — see below) plus the `DataSource` it came from,
a `verifiedAt` timestamp, and an optional raw payload snapshot.

The alternative — a `lastVerifiedAt` / `lastSourceId` pair of columns
directly on `Drug`/`Patent`/`Exclusivity` — is simpler to query but throws
away history: you can't see that two sources disagreed, or that a value
changed on a specific date, which matters once you're reconciling FDA data
against USPTO data against manual corrections. The append-only log costs a
join for "what's stale" queries (take the most recent `verifiedAt` per
entity) but keeps that information available. Example staleness query:

```sql
select p.id, p."patentNumber", max(i."verifiedAt") as last_verified
from "Patent" p
left join "IngestionRecord" i on i."patentId" = p.id
group by p.id
having max(i."verifiedAt") is null or max(i."verifiedAt") < now() - interval '30 days';
```

**The `CHECK` constraint:** Prisma's schema language has no first-class way
to say "exactly one of these three foreign keys must be set," so it's added
by hand in the migration SQL (`prisma/migrations/.../migration.sql`) after
the columns it was generated from. If this migration is ever regenerated
from `schema.prisma` (rather than adding a new migration on top), that
constraint needs to be re-added manually — it won't come back automatically.
I chose explicit nullable FKs (`drugId`/`patentId`/`exclusivityId`) over a
generic `entityType` + `entityId` polymorphic pair specifically so the
database can enforce this and so deletes cascade correctly; the cost is
that adding a fourth trackable entity type later means a migration to add
a fourth nullable FK column, not just a new enum value.

### What's deliberately not in the schema yet

- **No computed "generic entry date" field anywhere.** The date a generic
  can actually enter the market is `MAX` over every patent's
  `effectiveExpiryDate` and every exclusivity's `expirationDate` for a
  drug — an aggregate over children, not a fact about one row. Storing it
  as a column would mean it silently goes stale the moment a new patent is
  ingested. It belongs in a query (or a future materialized view) once
  ingestion exists, not in the schema now.
- **No `ActiveIngredient` join table.** `Drug.genericName` is free text
  (e.g. `"amlodipine and valsartan"` for a combination product), matching
  how the Orange Book itself represents it. A normalized many-to-many
  ingredient table would enable cross-drug ingredient search but isn't
  needed yet — flagged here as the natural upgrade if that becomes a
  real feature.

## Data ingestion: FDA Orange Book

`npm run ingest:orange-book` populates the data model above from the FDA's
Orange Book — the authoritative public list of approved drugs and the
patents/exclusivities protecting them.

### The source

FDA publishes it as a monthly-updated ZIP at
[fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files](https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files)
(direct download: `https://www.fda.gov/media/76860/download?attachment`,
current as of this writing — FDA also exposes the same data as a JSON API
via [openFDA](https://open.fda.gov/apis/drug/orangebook/), which was
considered but not used; see below). The zip unpacks to three
tilde-delimited (`~`) ASCII text files with a header row:

- **`products.txt`** — one row per approved drug product (brand/generic
  name, applicant, dosage form, route, strength, application number).
- **`patent.txt`** — one row per patent listed against a product.
- **`exclusivity.txt`** — one row per FDA-granted exclusivity.

**Why flat files over openFDA's API:** the ZIP is the canonical source FDA
itself publishes (openFDA is a derived mirror, also monthly); no API key or
rate limits; the field-by-field format is documented on the same page; and
a one-shot batch download fits a scheduled monthly pipeline better than
paginated API calls would.

### How the pipeline works

```
src/lib/ingestion/orangeBook/
  parse.ts    pure functions: raw file text -> typed rows, never touches the DB
  load.ts     typed rows -> DB, via upsert (idempotent) with bounded concurrency
  index.ts    orchestration: download/unzip, call parse + load, write run summary
scripts/ingest-orange-book.ts   CLI entrypoint (npm run ingest:orange-book)
```

- **Safe to re-run:** every write is an `upsert` keyed on the natural key
  designed into the schema (`Drug[applicationNumber,productNumber]`,
  `Patent[drugId,patentNumber,useCode]`,
  `Exclusivity[drugId,code,expirationDate]`) — running it twice in a row
  leaves the domain tables unchanged (verified: two consecutive real runs
  produced identical Drug/Patent/Exclusivity/Company counts).
- **Never crashes on a bad row:** every row is parsed defensively; a
  malformed row is logged to an in-memory `issues` list and skipped, not
  thrown. A single ingestion run's issues are grouped into categories (not
  a flat list) so a handful of rare, actionable problems don't get buried
  under thousands of a single benign, expected pattern.
- **Logs what happened:** each run writes one `IngestionRun` row (status,
  counts, duration, categorized issue summary as JSON) plus one
  `IngestionRecord` per successfully touched `Drug`/`Patent`/`Exclusivity`
  (the per-entity provenance log from the data model). Query recent runs
  with `SELECT * FROM "IngestionRun" ORDER BY "startedAt" DESC LIMIT 5;`.
- **`--file <path>`** runs against a local zip instead of downloading —
  useful for re-testing without hitting FDA repeatedly.

### What the source data actually looks like (and what surprised me)

Real findings from parsing the live file (~48.5k product rows, ~22.1k
patent rows, ~2.3k exclusivity rows), worth knowing before extending this:

- **Orange Book does not cover biologics.** Every `Appl_Type` in the real
  file is `N` (NDA) or `A` (ANDA) — never anything for a BLA. Biologics are
  tracked separately in FDA's "Purple Book," a different dataset. The
  `BLA` value in the `ApplicationType` enum will stay permanently unused
  unless that separate source is ingested too.
- **Pediatric exclusivity is encoded as a second row, not a flag.** A
  patent that gained the 6-month pediatric extension appears as a
  *second* line in `patent.txt`: the same patent number with a `*PED`
  suffix (e.g. `8573209*PED`) and a later expiry date. The pipeline groups
  rows by (application, product, base patent number, use code) and merges
  the pair: the plain row's date becomes `nominalExpiryDate`, the `*PED`
  row's date becomes `effectiveExpiryDate`. Of ~2,353 pediatric-marked
  patents, only 876 had *both* rows (a real nominal/effective pair); 1,477
  had *only* the `*PED` row with no un-extended baseline in the file — for
  those, nominal and effective are set equal and
  `expiryAdjustmentDays` is left `null` (unconfirmed), exactly per the
  schema's documented convention.
- **FDA's own docs say the listed patent date "includes applicable
  extensions."** So even the plain (non-`*PED`) row isn't a naive
  filing-date-plus-20-years figure — it's already applicant-asserted as
  post-adjustment. `Patent.txt` has no filing date field at all, so this
  pipeline cannot independently derive a true from-scratch nominal date;
  it treats Orange Book's own figure as the best available `nominal`
  baseline. A second source (e.g. a USPTO patent term calculation) would
  be needed to verify it independently — see `Patent.filingDate`, which
  stays `null` from this source.
- **Patent numbers aren't all-numeric.** ~11.6% of patent rows (2,564 of
  22,131) are reissue patents formatted `RE#####`, not plain digits. The
  parser doesn't assume a numeric-only format anywhere.
- **The "Patent Delist Request Flag" means the opposite of what it
  sounds like.** Per FDA's own field description, `Y` means a sponsor
  *asked* to delist the patent but it's still listed (retained for
  180-day-exclusivity purposes) — the patent's presence in the file at
  all already means it's still listed. This pipeline does not map that
  flag to `Patent.delistedAt`; true delisting can only be detected by
  diffing against a previous month's snapshot, which isn't built yet.
- **FDA's own format documentation is inconsistent with the real data.**
  The page describes `Patent_Use_Code` and `Exclusivity_Code` as
  `nnnnnnnnnn` (numeric) — real values are alphanumeric (`U-1234`,
  `ODE-045`, `GAIN`, `NCE`), consistent with the schema's decision to
  keep both as free-text strings rather than enums.
- **The source has literal duplicate lines.** `exclusivity.txt` contained
  74 rows that were byte-for-byte repeats of another row's full natural
  key. Upserting duplicates from the *same* batch concurrently raced two
  inserts against the same not-yet-existing row (a real bug, caught and
  fixed by deduplicating in memory before the concurrent upsert pass —
  see the comment on `dedupeByKey` in `load.ts`).
- **The applicant name field is truncated; a second field isn't.**
  `Products.txt`'s `Applicant` column is FDA-truncated to 20 characters;
  `Applicant_Full_Name` (last column) isn't. The pipeline uses the latter
  for `Company.name`. Six rows had stray trailing whitespace on that field
  that would have silently created duplicate `Company` rows if not
  trimmed.
- **One real company can be many `Company` rows.** "Pfizer" alone spans 9+
  distinct legal-entity strings in the applicant data (`PFIZER INC`,
  `PFIZER LABS`, `PFIZER CENTRAL RESEARCH`, ...). This is FDA's own
  entity data, not a pipeline bug — there's no parent-company concept in
  the source to collapse them.
- **~5,873 products have no real approval date** — a sentinel string
  `"Approved Prior to Jan 1, 1982"` instead, which the pipeline maps to
  `null` rather than trying to parse.
- **A Prisma/Postgres modeling gap surfaced by this work:** the original
  `Patent.useCode` was nullable, but Postgres treats every `NULL` as
  distinct in a unique constraint, so `(drugId, patentNumber, useCode)`
  couldn't be used for a typed idempotent upsert on the common case of "no
  use code." Fixed by migrating `useCode` to a non-null `""` sentinel
  default (see `prisma/migrations/20260813202855_patent_use_code_not_null`
  and the comment on `Patent.useCode` in `schema.prisma`) — a real example
  of ingestion work revealing a schema decision that looked fine on paper
  but didn't survive contact with Prisma's typed API.
- **A benign `pg` deprecation warning appears during ingestion** ("Calling
  client.query() when the client is already executing a query") under
  concurrent upserts. Verified harmless — `@prisma/adapter-pg` uses a real
  `pg.Pool` internally (not a bare `Client`), and two consecutive runs
  produced correct, identical, race-free counts. Left as a known rough
  edge of Prisma 7's driver-adapter layer rather than chased further;
  worth revisiting if a future Prisma/`pg` upgrade removes it.

### Result of the first real run (2026-08-13)

| Entity | Count |
|---|---|
| Companies | 1,976 |
| Drugs (products) | 48,502 |
| Patents | 21,255 (from 22,131 raw rows — collapsed by *PED merging + a few duplicate groups) |
| Exclusivities | 2,267 (from 2,341 raw rows — 74 were literal duplicates) |

## Patent Term Adjustment enrichment

`npm run enrich:pta` corrects the single most common source of a wrong
expiry date: the Orange Book's listed patent expiry doesn't reliably
reflect Patent Term Adjustment (PTA) — extra days USPTO grants a patent to
compensate for its own examination delays (35 U.S.C. § 154(b)). This is a
core value-add of the product, so it gets its own pipeline and its own
authoritative source, separate from the Orange Book ingestion.

### The source

**USPTO's Open Data Portal (ODP)**, specifically the Patent File Wrapper
Search endpoint (`GET https://api.uspto.gov/api/v1/patent/applications/search`),
queried by patent number. It returns `patentTermAdjustmentData.adjustmentTotalQuantity`
(the authoritative total PTA in days) and `applicationMetaData.filingDate`
in one response — no need for a separate application-number lookup step.

This is the actual most-authoritative source available (it's the USPTO's
own system of record — PTA is a USPTO-computed figure, not something any
third party independently re-derives more reliably). Alternatives
considered and rejected:

- **Google Patents' public pages** show a PTA-adjusted expiration, but it's
  unstructured, heavy, JS-rendered content not meant for programmatic
  bulk access — fragile to build a repeatable pipeline on.
- **PatentsView API** — a bibliographic/citation API; doesn't carry PTA
  data.
- **USPTO bulk XML files** — as of a recent policy change, even bulk
  *downloads* now require signing into a USPTO.gov account, so this
  doesn't avoid the authentication requirement anyway.

**Getting access requires you, personally, to do something I can't do for
you:** an ODP API key requires a USPTO.gov account *plus* ID.me identity
verification (document upload or a live video call — this is a real
identity check, not a normal developer signup). Steps:

1. Create a USPTO.gov account at [account.uspto.gov](https://account.uspto.gov).
2. Verify your identity via [ID.me](https://www.uspto.gov) (linked from the
   ODP "Manage API Key" page once signed in).
3. Link the two accounts and request API Key access from the "Manage API
   Key" page in the [Open Data Portal](https://data.uspto.gov).
4. Put the key in `.env`: `USPTO_ODP_API_KEY="..."`.

Full steps: [data.uspto.gov/apis/getting-started](https://data.uspto.gov/apis/getting-started).

### Rate limits shape the whole design

ODP's documented limit is **burst = 1**: no concurrent requests at all,
ever, per API key, plus explicit guidance against aggressive retries on
`429`. Unlike the Orange Book pipeline (concurrency 6), this one is
**strictly sequential** — one patent at a time, ~350ms between calls, and a
5-second backoff on `429` (see `src/lib/ingestion/pta/client.ts`). At that
pace, enriching all ~21k patents takes on the order of an hour or two —
which is exactly why resumability matters here more than anywhere else in
this codebase.

### How it's resumable

No new schema needed — it reuses the provenance model from the data model
design. A patent is a "candidate" for enrichment if it has **no
`IngestionRecord` yet from the "USPTO Patent Term Adjustment (ODP)"
`DataSource`**. Every patent processed — whether PTA data was found,
confirmed absent, or the lookup failed — is either recorded immediately
(success/no-data) or left untouched (transient error), one at a time, in
its own small transaction:

- **Found real PTA data:** update the patent's `filingDate`,
  `effectiveExpiryDate`, `expiryAdjustmentDays`, and write an
  `IngestionRecord` (with the raw API response saved for audit) — in the
  same transaction, so a crash can't leave the two out of sync.
- **Checked, no data available** (pre-2001 filing, or just not in USPTO's
  system): still write the `IngestionRecord` — so this patent isn't
  retried forever — but leave its dates untouched.
- **Transient failure** (network error, USPTO 5xx, rate limit exhausted):
  write nothing. It stays a "candidate" and gets picked up automatically
  on the next run.
- **403 (bad/missing API key):** abort the whole run immediately rather
  than burning through the candidate list — a bad key won't fix itself on
  patent #2. Verified: a deliberately invalid key fails in 0.4s instead of
  retrying blindly.

Stop the process (Ctrl-C, crash, whatever) at any point and re-run
`npm run enrich:pta` — already-processed patents are skipped automatically,
no duplicate work, no re-billed API calls.

### How `effectiveExpiryDate` is computed

- **Standard (all-numeric) patent number:** `effectiveExpiryDate =
  filingDate + 20 years + adjustmentTotalQuantity`, computed independently
  from USPTO's own filing date — *not* as a delta added on top of Orange
  Book's number. Orange Book's own docs claim its listed date "includes
  applicable extensions," so adding PTA on top of it risks double-counting
  when that claim happens to be true for a given patent; computing fresh
  from USPTO's filing date avoids that ambiguity entirely.
  `nominalExpiryDate` (the Orange Book value) is deliberately left
  untouched — it still means "what's officially listed," right or wrong.
  `expiryAdjustmentDays` is recomputed as the gap between the two, which is
  now a real, USPTO-verified number instead of Orange Book's
  often-unconfirmed one.
- **Reissue / non-standard patent number** (`RE#####` etc.): a reissue
  patent inherits the *remaining term of the original patent it reissued
  from* — "filing date + 20 years" does not apply. Without also resolving
  the original patent's term (not attempted here), this pipeline instead
  applies USPTO's PTA days as a delta on top of the existing
  `nominalExpiryDate`, and says so explicitly in the `IngestionRecord`.
- **Known limitation, documented rather than papered over:** continuation
  and divisional applications' 20-year term legally runs from the
  *earliest* priority-claimed filing date in the continuity chain, not
  necessarily this specific application's own filing date. This pipeline
  uses the application's own filing date only. USPTO's response includes
  `parentContinuityBag` data that would let a future pass resolve this
  correctly — the full raw response is saved on every `IngestionRecord`
  specifically so that refinement doesn't require re-querying USPTO.

### A cross-pipeline fix this work required

Running the Orange Book ingestion again after PTA enrichment would have
silently overwritten the corrected `effectiveExpiryDate` back to the naive
Orange Book figure — its upsert unconditionally set that field. Fixed in
`src/lib/ingestion/orangeBook/load.ts`: before upserting a patent, it now
checks whether the existing row already has a non-null `filingDate` (a
reliable signal PTA enrichment already ran, since Orange Book itself never
sets that field) and, if so, leaves `effectiveExpiryDate` /
`expiryAdjustmentDays` alone. Both pipelines are independently resumable;
they now also coexist correctly when run repeatedly in either order.

### Useful commands

```bash
npm run enrich:pta                          # process all unenriched patents
npm run enrich:pta -- --limit 20            # process only the next 20 (prioritized by soonest-expiring)
npm run enrich:pta -- --patent 6967208,8722693   # enrich specific patent numbers only
```

## API

The product surface: "show me patents expiring soon, so I can act on generic
entry opportunities before competitors do." Two endpoints, both `GET`, both
JSON.

**Browse the interactive docs at `/docs`** (run `npm run dev`, then open
[http://localhost:3000/docs](http://localhost:3000/docs)) — a full Swagger/Scalar-style reference with
try-it-now requests and generated code samples in several languages. The
raw spec is at `/api/openapi.json`.

### `GET /api/drugs` — list / search, ranked by soonest generic entry

Every drug in the response carries `estimatedGenericEntryDate`: the latest
expiry date among that drug's currently-listed patents and exclusivities
(computed in the database via a window-function query in
[queries.ts](src/lib/drugs/queries.ts), not fetched-then-computed in JS —
it has to filter, sort, and paginate on this value across tens of
thousands of drugs). Drugs with no listed patent or exclusivity at all are
excluded — nothing to report.

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string, 1-200 chars | — | Substring match against brand name, generic name, or company name, case-insensitive |
| `withinDays` | integer, 0-36500 | — | Only drugs whose estimate falls within this many days from now. No lower bound — already-past estimates are included too (still-actionable, already-open opportunities) |
| `expiresAfter` / `expiresBefore` | date (`YYYY-MM-DD`) | — | Explicit generic-entry date-range bounds, inclusive. See [Advanced search](#advanced-search--drug-classification) below |
| `modality` | enum | — | Exact match on structural drug type — see [Advanced search](#advanced-search--drug-classification) |
| `drugClass` | string | — | Exact match on the best-effort mechanism/therapeutic tag (e.g. `"Statin"`) |
| `applicationType` | `NDA` \| `ANDA` \| `BLA` | — | Exact match |
| `dosageForm` | string | — | Exact match (e.g. `"TABLET"`) — see `GET /api/drugs/filter-options` for the current vocabulary |
| `sort` | `entry_asc` \| `entry_desc` | `entry_asc` | Soonest-first by default |
| `limit` | integer, 1-100 | 20 | Page size |
| `offset` | integer, ≥0 | 0 | Pagination offset |

All filters combine with AND. `withinDays` and `expiresAfter`/`expiresBefore`
both filter the same underlying `estimatedGenericEntryDate` — they're not
mutually exclusive, but a caller will typically use one or the other
(`withinDays` for the UI's quick horizon chips, the explicit range for
precise queries).

```bash
curl "http://localhost:3000/api/drugs?withinDays=180&limit=10"
curl "http://localhost:3000/api/drugs?q=eliquis"
```

```json
{
  "data": [
    {
      "id": "...", "brandName": "ELIQUIS", "genericName": "APIXABAN",
      "applicationType": "NDA", "applicationNumber": "NDA202155", "productNumber": "001",
      "dosageForm": "TABLET", "route": "ORAL", "strength": "2.5MG",
      "approvalDate": "2012-12-28",
      "modality": "SMALL_MOLECULE", "drugClass": null,
      "company": { "id": "...", "name": "BRISTOL MYERS SQUIBB CO..." },
      "estimatedGenericEntryDate": "2031-08-24",
      "patentCount": 12, "exclusivityCount": 2
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 2847, "hasMore": true }
}
```

### `GET /api/drugs/:id` — full detail on one drug

Every patent and exclusivity on file, plus `genericEntryEstimate` — the
product's core value-add made explicit and auditable, not a black box:

```json
{
  "data": {
    "id": "...", "brandName": "ELIQUIS", "...": "...",
    "patents": [ { "id": "...", "patentNumber": "9326945", "nominalExpiryDate": "...", "effectiveExpiryDate": "2031-08-24", "expiryAdjustmentDays": 411, "...": "..." } ],
    "exclusivities": [ { "id": "...", "code": "NCE", "expirationDate": "...", "...": "..." } ],
    "genericEntryEstimate": {
      "date": "2031-08-24",
      "controllingType": "patent",
      "controllingId": "...",
      "controllingLabel": "Patent 9326945",
      "basis": "The latest-expiring patent (Patent 9326945) determines this estimate — every other listed patent and exclusivity for this drug expires on or before 2031-08-24."
    }
  }
}
```

`404` (structured, see below) if the id doesn't exist.

### Validation and errors

Every query param is validated with [Zod](https://zod.dev) — the same
schemas ([schemas.ts](src/lib/drugs/schemas.ts)) also generate the OpenAPI
doc, so the docs can't drift from what the code actually accepts. Invalid
input never reaches the database; it gets a structured `400` instead:

```bash
curl "http://localhost:3000/api/drugs?limit=9999"
```
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more query parameters are invalid.",
    "details": [{ "field": "limit", "message": "Too big: expected number to be <=100" }]
  }
}
```

Every error response — `400`, `404`, `500` — uses this same `{ error: { code, message, details? } }`
envelope ([errors.ts](src/lib/api/errors.ts)), so a frontend needs exactly
one error-handling code path, not one per endpoint. `500`s log the real
error server-side but only ever return a generic message to the client —
raw error internals (stack traces, SQL, connection strings) never leak
into a response.

### Design notes

- **The list query is one SQL statement, not N+1.** A CTE computes each
  drug's `estimated_generic_entry_date` via `GREATEST(MAX(patent dates),
  MAX(exclusivity dates))` with a `GROUP BY`, then the outer query filters,
  sorts, and paginates on that computed value, with `count(*) OVER()`
  getting the total row count in the same round trip. Building this any
  other way — fetch drugs, then fetch each one's patents/exclusivities to
  filter/sort in JS — wouldn't scale past a few hundred rows.
- **The search term is escaped before hitting `ILIKE`.** A literal `%` or
  `_` in a user's search (e.g. searching for a strength like `"50%"`)
  is escaped so it's matched as a literal character, not treated as a SQL
  wildcard (verified with a test).
- **Delisted patents don't count.** Both the list query and the detail
  endpoint's `genericEntryEstimate` exclude any patent with `delistedAt`
  set from the computation — a patent no longer listed is no longer a
  barrier, even though the row itself is kept for history.
- **The detail endpoint's estimate is a pure, testable function**
  ([`computeGenericEntryEstimate`](src/lib/drugs/queries.ts)) — given a
  drug's patents and exclusivities, it returns not just a date but *which*
  one is controlling and why, in plain English. This is deliberately kept
  separate from the list query's SQL aggregation: the list needs to be
  fast across thousands of drugs, so it only computes the date; the detail
  view needs to be transparent about one drug, so it explains itself.

### Tests

```bash
npm test              # run once
npm run test:watch    # watch mode
npm run test:coverage # with coverage (97% statements as of writing)
```

Tests run against a **real, separate Postgres database** (`patent_horizon_test`,
configured via `.env.test`), not mocks — the whole point of this API is a
nontrivial SQL aggregation query, and mocking Prisma would never have
caught a bug in that SQL. One-time setup:

```bash
createdb patent_horizon_test
DATABASE_URL="postgresql://$(whoami)@localhost:5432/patent_horizon_test?schema=public" npx prisma migrate deploy
```

Each test file truncates and reseeds a small, deterministic fixture set
([tests/helpers.ts](tests/helpers.ts)) in `beforeEach` — dates are relative
offsets from "now" (e.g. "+10 days", "-30 days"), not hardcoded absolute
dates, so the suite stays valid indefinitely. Test files run sequentially
(`fileParallelism: false` in `vitest.config.mts`) since they share one
database; running them in parallel let one file's reset race another
file's in-progress seed (caught this directly — the fix is in the config).

Coverage includes: which drugs count as having a "known barrier" at all,
which of a patent/exclusivity pair controls the estimate, delisted-patent
exclusion, pagination boundaries (including an offset past the end),
search matching (including the `%`-escaping case), every validation
failure mode, and both success and 404 paths through the actual route
handlers (not just the query functions underneath them).

## Advanced search & drug classification

Beyond the time-horizon and name search covered above, `/api/drugs` (and
the "Advanced" panel in the web UI) supports narrowing results by
structural drug type, therapeutic class, application type, dosage form, and
an explicit generic-entry date range. Application type and dosage form come
straight from the Orange Book source data. Modality and drug class don't —
that data doesn't exist anywhere in the source, so it's derived.

### How classification works

`genericName` (the active-ingredient field) is classified two ways at
ingestion time ([`src/lib/ingestion/orangeBook/load.ts`](src/lib/ingestion/orangeBook/load.ts)),
using pharmaceutical naming-stem conventions ([INN/USAN](https://www.who.int/teams/health-product-and-policy-standards/inn) —
the standardized suffix system drug names follow, e.g. every monoclonal
antibody name ends in `-mab`, every statin in `-statin`):

- **`modality`** ([`src/lib/classification/modality.ts`](src/lib/classification/modality.ts)) — a small,
  fixed taxonomy: `SMALL_MOLECULE` (the default), `PEPTIDE`,
  `OLIGONUCLEOTIDE`, `MONOCLONAL_ANTIBODY`, `OTHER`. Modeled as an enum
  because the vocabulary is small and stable.
- **`drugClass`** ([`src/lib/classification/drugClass.ts`](src/lib/classification/drugClass.ts)) — an
  open-ended, best-effort mechanism/therapeutic tag (`"Statin"`, `"ACE
  inhibitor"`, `"Kinase inhibitor"`, ...), nullable free text rather than an
  enum, for the same reason `Exclusivity.code` is a free string: the real
  vocabulary is larger and less reliably detectable than modality. A drug
  can plausibly belong to more than one class; the schema stores one
  best-effort tag, so the first matching rule (in priority order) wins.

Both are **heuristics, not authoritative** — false negatives are possible
for ingredients that don't follow standard INN naming. Every stem rule that
shipped was checked against this project's real ~2,700 distinct
`genericName` values before being added, specifically to catch coincidental
suffix matches:

- Naive substring matching on `-rsen` (the oligonucleotide stem) matched
  **"ARSENIC TRIOXIDE"** — "arsenic" contains "rsen" mid-word but doesn't
  *end* with it. Fixed by matching stems only as suffixes of individual
  whitespace/punctuation-separated tokens
  ([`tokenize.ts`](src/lib/classification/tokenize.ts)), never as a
  substring anywhere in the raw string.
- `-statin` alone would also tag **cilastatin** (a renal enzyme inhibitor,
  unrelated to cholesterol), **nystatin** (an antifungal), and
  **pentostatin** (an oncology drug) — real drugs that coincidentally end in
  "statin" without being statins. Excluded explicitly per stem rule.

Existing rows are backfilled with `npm run classify:drugs` (safe to re-run
any time, e.g. after adding a new stem rule — it always recomputes from the
current `genericName`, never accumulates drift; supports `--dry-run` and
`--limit N` for previewing before writing).

### A real data limitation, not a bug: zero monoclonal antibodies

Searching `modality=MONOCLONAL_ANTIBODY` currently returns **zero results**.
This is expected, not a classifier failure: monoclonal antibodies are
biologics, regulated under a BLA (Biologics License Application) rather
than an NDA/ANDA, and FDA tracks BLA patent/exclusivity data in a *separate*
publication — the **Purple Book** — which this project does not ingest (see
[Data ingestion](#data-ingestion-fda-orange-book)). The `-mab` stem rule and
the `MONOCLONAL_ANTIBODY` enum value are both still shipped, deliberately,
so the classifier and the advanced-search filter vocabulary are ready the
day a Purple Book source ever gets ingested — the alternative (removing the
option because it's currently empty) would silently hide that this is a
known, documented gap rather than an intentional absence. The same
reasoning applies to `applicationType=BLA`, which is also always empty
today.

### `GET /api/drugs/filter-options` — current filter vocabulary

Powers the advanced-search UI's select inputs. `modalities` and
`applicationTypes` return every possible enum value (including
`MONOCLONAL_ANTIBODY` / `BLA`, per above); `drugClasses` returns the fixed
set of class labels the classifier can produce; `dosageForm` is genuinely
open-ended free text from the source (117 distinct values as of writing),
so that one is a live `DISTINCT` query against the current data rather than
a hardcoded list.

```bash
curl "http://localhost:3000/api/drugs/filter-options"
```
```json
{
  "data": {
    "modalities": [
      { "value": "SMALL_MOLECULE", "label": "Small molecule" },
      { "value": "PEPTIDE", "label": "Peptide" },
      { "value": "OLIGONUCLEOTIDE", "label": "Oligonucleotide" },
      { "value": "MONOCLONAL_ANTIBODY", "label": "Monoclonal antibody" },
      { "value": "OTHER", "label": "Other / complex molecule" }
    ],
    "drugClasses": ["Statin", "Angiotensin receptor blocker (ARB)", "..."],
    "applicationTypes": ["NDA", "ANDA", "BLA"],
    "dosageForms": ["CAPSULE", "CAPSULE, EXTENDED RELEASE", "..."]
  }
}
```

## Web UI

The primary screen — `/` — is the thing a pharma business analyst is meant
to have open daily: a dense, sortable, filterable table of every drug with
a known patent or exclusivity, ranked by estimated generic-entry date.
Clicking a row (or `/drugs/:id` directly) opens the full picture for that
drug: every patent and exclusivity, and the same transparent
`genericEntryEstimate` the API returns, rendered as the headline of the
page rather than buried in a table.

### Design choices

- **URL is the source of truth for all filter/sort/pagination state**
  (`?q=...&withinDays=...&sort=...&offset=...`) — the initial page load is
  a Server Component that calls `listDrugs()` directly (no self-fetch over
  HTTP), and every interaction (`src/components/drugs/DrugsExplorer.tsx`,
  a Client Component) just rewrites the URL via `router.replace`. This
  makes every filtered view bookmarkable and shareable, keeps the browser
  back button meaningful, and means there's exactly one code path for
  "render the list" — first load and every subsequent filter change go
  through the same server query.
- **Server-rendered, not a client-side fetch waterfall.** The table's data
  is already in the initial HTML; interaction re-navigates rather than
  calling the API from the browser. Filter/sort/pagination changes are
  wrapped in `useTransition` so the *previous* results stay visible
  (dimmed, with a small spinner) while the new page streams in, instead of
  flashing a blank loading state on every keystroke.
- **A default page size of 50, not the API's default of 20.** This is
  a dense professional tool, not a consumer feed — the UI layer
  deliberately overrides the API default rather than changing the API's
  own default (which is the right one for a generic API consumer).
- **Sort is honest about what the API actually supports.** Only the
  "Est. Generic Entry" column header is clickable — `/api/drugs` only
  supports ordering by that computed date, so no other column pretends to
  be sortable. A UI affordance that doesn't work is worse than no
  affordance.
- **Color-coded urgency, not just a date.** Every estimated date gets a
  bucket — already-open (green), within 6 months (red), within 2 years
  (amber), further out (gray) — computed client-and-server-consistently in
  `src/lib/format.ts`, so the table is scannable by color before anyone
  reads a single date.
- **`/` focuses search** (unless already typing somewhere) — a small
  power-user affordance for a screen meant to be used many times a day.
- **The Advanced panel follows the same URL-is-truth pattern** as the rest
  of the screen — modality/drugClass/applicationType/dosageForm/date-range
  are just more query params, so an advanced-filtered view is bookmarkable
  like any other. The panel auto-expands on load if any of those params are
  already set (e.g. from a shared link), and its toggle button shows a
  count badge of how many advanced filters are active. Select options come
  from `GET /api/drugs/filter-options`, fetched server-side alongside the
  drug list itself — no client-side waterfall for the filter UI either.
- **A real bug this surfaced:** `notFound()` inside a route wrapped by
  `loading.tsx` can't actually set a `404` status — by the time
  `notFound()` runs, the Suspense fallback has already started streaming
  the response with `200`, and HTTP headers can't change after that (this
  is documented Next.js behavior, not a framework bug). The home page's
  `loading.tsx` was cascading down and silently swallowing 404s on
  `/drugs/[id]`, which had no loading state of its own. Fixed by moving the
  home page into an `(home)` route group so its loading boundary no longer
  wraps sibling routes — verified `/drugs/<bad-id>` returns a real `404`
  in both dev and a production build.

## Accounts and access control

Patent Horizon is built as a subscription product, so every screen and API
route requires an account. There's no payment processing yet — that's
deliberately deferred until there's evidence people want this (see
[Deploying](#deploying)) — but the account/access-tier system underneath it
is real and meant to be secure now, not a placeholder.

### Two tiers

- **Subscriber** (`role: "user"` in the database) — the paying-customer
  tier. Read access to the product: the drugs table, drug detail, the API.
- **Analyst** (`role: "admin"`) — for the founder and employees. Everything
  a Subscriber can do, plus `/team`: view every account, promote/demote
  between tiers, reset a user's password, remove an account.

The underlying role strings are Better Auth's own default admin-plugin
values (`"admin"` / `"user"`) — kept as-is rather than renamed, so the
plugin's own built-in authorization checks (which key off those exact
strings unless you configure custom access control) keep working
unmodified. "Analyst" / "Subscriber" is a presentation-layer relabeling
that happens in exactly one place: `toAccessTier()` in
[src/lib/session.ts](src/lib/session.ts).

### How someone becomes an Analyst

`ANALYST_EMAILS` in `.env` is a comma-separated allowlist. Any signup whose
email matches gets `role: "admin"` automatically, via a
`databaseHooks.user.create.before` hook in
[src/lib/auth.ts](src/lib/auth.ts) — no manual database edit needed to
bootstrap the founder's own account or add a new employee. Add someone
after the fact (a contractor, someone who signed up before being added to
the list) from `/team` instead — any existing Analyst can promote them.

### Library: Better Auth

Chosen over Auth.js/NextAuth (whose current stable line is still v4; v5
has been in beta for a long time) specifically because its peer
dependencies declare support for our exact stack (Next.js 16, Prisma 7),
its email/password flow is first-class rather than a secondary
"credentials provider," and its **admin plugin** gives battle-tested
user-management operations (`setRole`, `setUserPassword`, `removeUser`,
`listUsers`) instead of hand-rolled equivalents for exactly the
"employees who can make changes" capability this task asked for.

Schema (`User`, `Session`, `Account`, `Verification` in `schema.prisma`) is
**generated, not hand-written** — `npx auth generate` from
[src/lib/auth.ts](src/lib/auth.ts). If the auth config changes (a new
plugin, a new field), regenerate rather than hand-editing those models;
diff the output before applying, the same way
`prisma/migrations/20260813200111_init_patent_data_model`'s hand-added
`CHECK` constraint is preserved by never running a from-scratch
regeneration over it.

### Two layers of protection (defense in depth)

1. **`src/proxy.ts`** (Next.js 16 renamed `middleware.ts` → `proxy.ts`) —
   an *optimistic* check: does a session cookie exist at all? Runs on
   every request, redirects signed-out visitors to `/login` before
   anything renders. Deliberately cheap (no database call) and
   deliberately **not** the real security boundary — a forged cookie
   would sail through this check.
2. **`src/lib/session.ts`**'s `requireUser()` / `requireAnalyst()` (Server
   Components) and `getSessionUser()` (Route Handlers) — the actual
   boundary. Every protected page and every protected API route calls one
   of these directly; each does a real, database-backed session lookup.
   This split exists because Next's own authentication guide is explicit
   that proxy/middleware "should not be your only line of defense" — the
   two-tier pattern here matches their documented recommendation, not an
   invented one.

Server Actions (`/team`'s promote/demote/reset-password/remove) add a
**third** check: each action calls `requireAnalyst()` again itself, even
though the only page that renders their UI is already gated. A Server
Action is a public endpoint in its own right — reachable directly, not
just through that page's buttons — so it can't trust that whatever
rendered it already checked. Also: no user can demote or remove their own
account (checked server-side in the action, not just disabled in the UI),
so an Analyst can't accidentally lock themselves out.

### A real testability bug this surfaced (and the fix)

`next/headers()` — the ambient API Server Components use to read cookies —
only works inside an actual Next.js request; it throws "called outside a
request scope" if invoked any other way, including calling a route
handler's exported `GET()` directly, which is exactly how this project's
route-handler tests work (see [API](#api) → Tests). Initially
`getCurrentUser()` was the *only* session helper, built on `next/headers()`,
and every route handler called it — which would have made every API test
fail the moment auth was added.

Fixed by adding a second helper, `getSessionUser(request)`, that reads
`request.headers` directly instead of going through the ambient API. Route
Handlers already receive the request explicitly, so this isn't a
workaround — it's arguably the more correct way for them to do it, and it
has the side benefit of making them callable directly in tests. Server
Components still use `next/headers()` via `requireUser()`/`requireAnalyst()`
since they have no request object to read from directly.

### Tests

`npm test` now includes `tests/auth.test.ts` (56 tests total across the
suite): the analyst-allowlist logic as pure-function unit tests (not an
env-var-dependent integration test — `ANALYST_EMAILS` is deliberately
empty in `.env.test`), `getSessionUser()` behavior including a garbage
cookie, and — the security-critical part — that Better Auth's admin
operations (`setRole`, `setUserPassword`, `removeUser`) genuinely succeed
for a real Analyst session and genuinely throw for a real Subscriber
session, using `tests/helpers.ts`'s `createTestUser()` (a real signup
through Better Auth, not a hand-inserted session row, so the cookie is
authentically valid).

**Known gap:** the `/team` Server Actions' own `requireAnalyst()` re-check
and self-demotion/self-removal guards are verified by manual testing
(promote/demote/reset/remove all exercised against a running dev server),
not by an automated test — Server Actions depend on Next's ambient request
context the same way `next/headers()` does, and unlike Route Handlers they
receive no request object to read from directly instead, so they can't be
invoked directly in Vitest the way route handlers can. This is a known
limitation of testing Next.js Server Actions in isolation, not a shortcut
specific to this codebase.

### Known limitations (flagged, not hidden)

- **No email verification, no self-service password reset.** Both need an
  email-sending provider, which isn't wired up. An Analyst can reset any
  user's password from `/team` as a stopgap. Signing up grants immediate
  access with no verification step.
- **No rate limiting on login/signup.** `minPasswordLength: 10` (above
  Better Auth's default of 8) is a cheap partial mitigation against
  credential stuffing until real rate limiting exists.
- **API docs (`/docs`, `/api/openapi.json`) and `/api/health` are
  intentionally left public** — they describe the API's shape rather than
  expose any actual patent data, and `/api/health` needs to stay reachable
  for uptime monitoring without auth.

## Project layout

```
prisma/schema.prisma       Data model (single source of truth for the DB)
prisma/migrations/         Generated SQL migrations (checked into git)
src/app/(home)/page.tsx    Primary screen: patent-expiration table (route group — see "Web UI")
src/app/drugs/[id]/        Drug detail screen: full patent/exclusivity picture
src/app/login/, signup/    Sign in / create account pages
src/app/team/              Analyst-only user management (page.tsx + Server Actions in actions.ts)
src/app/api/auth/[...all]/ Better Auth's own routes (sign-in, sign-up, session, admin ops, ...)
src/app/api/health/        GET /api/health — DB connectivity check
src/app/api/drugs/         GET /api/drugs, GET /api/drugs/[id] — the product API
src/app/api/openapi.json/  Serves the generated OpenAPI 3.1 spec
src/app/docs/              Interactive API docs (Scalar), reads the spec above
src/proxy.ts               Optimistic signed-out redirect (Next 16's "middleware", renamed)
src/components/auth/       Login/signup forms, header user menu, team management table
src/components/drugs/      UI: table, filter bar, detail-page cards, shared badges
src/lib/auth.ts            Better Auth server config (roles, hooks, plugins)
src/lib/auth-client.ts     Better Auth client (used by login/signup/team UI)
src/lib/session.ts         requireUser()/requireAnalyst()/getSessionUser() — the real access control
src/lib/analystAllowlist.ts  Pure allowlist logic behind ANALYST_EMAILS (unit-tested separately)
src/lib/prisma.ts          Shared Prisma client singleton
src/lib/format.ts          Date/relative-time/urgency formatting shared by the UI
src/lib/api/               Shared API infra: error envelope, query-param parsing
src/lib/drugs/             Zod schemas + DB queries backing the drugs API and UI
src/lib/openapi/           Builds the OpenAPI doc from the Zod schemas above
src/lib/ingestion/orangeBook/   Orange Book ingestion pipeline (parse/load/orchestrate)
src/lib/ingestion/pta/     USPTO Patent Term Adjustment enrichment (client/enrich/orchestrate)
scripts/ingest-orange-book.ts   CLI entrypoint: npm run ingest:orange-book
scripts/enrich-pta.ts      CLI entrypoint: npm run enrich:pta
tests/                     Vitest suite — runs against a real, separate test database
src/generated/prisma/      Generated Prisma Client (git-ignored, regenerated on install)
docker-compose.yml         Optional: run Postgres in Docker instead of natively
```

## Local setup

You need Node.js 20+ and a running PostgreSQL instance. Pick one of the two
options below for Postgres.

### 1. Install dependencies

```bash
npm install
```

(This also runs `prisma generate` automatically via a `postinstall` hook.)

### 2. Get a local Postgres running

**Option A — Homebrew (what this project currently uses):**

```bash
brew install postgresql@16
brew services start postgresql@16
createdb patent_horizon_dev
```

**Option B — Docker (if you have it installed):**

```bash
docker compose up -d
```

If you use Docker, update `DATABASE_URL` in `.env` to match the credentials
in `docker-compose.yml` (`patent_horizon` / `patent_horizon`).

### 3. Configure environment variables

```bash
cp .env.example .env
```

Then edit `.env`:

- `DATABASE_URL` — only if it differs from the default.
- `BETTER_AUTH_SECRET` — generate with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` — `http://localhost:3000` for local dev.
- `ANALYST_EMAILS` — your own email (comma-separated if adding teammates
  now). Whoever signs up with a matching email gets the elevated Analyst
  role automatically — see [Accounts and access control](#accounts-and-access-control).

### 4. Run migrations

```bash
npx prisma migrate dev
```

### 5. Start the app and sign up

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll land on
`/login` (everything requires an account). Click "Sign up" and register
with the email you put in `ANALYST_EMAILS`; that first account is
automatically an Analyst, with access to `/team` for adding anyone else.

- Health check (no auth required): [http://localhost:3000/api/health](http://localhost:3000/api/health)
  — returns `{"status":"ok","database":"connected"}` when the DB is reachable.

## Useful commands

```bash
npm run dev          # start the dev server
npm run build         # production build
npm run lint          # ESLint
npx tsc --noEmit       # type-check
npm run db:migrate    # create + apply a new migration (prisma migrate dev)
npm run db:studio     # open Prisma Studio (GUI for the database)
npm run ingest:orange-book            # download + load the current FDA Orange Book
npm run ingest:orange-book -- --file ./orangebook.zip   # load from a local zip instead
npm run enrich:pta                    # enrich all unenriched patents with USPTO PTA data
npm run enrich:pta -- --limit 20      # sample run: next 20 patents only
npm run classify:drugs                # backfill modality/drugClass for existing drugs
npm run classify:drugs -- --dry-run   # preview counts without writing
npm test              # run the test suite once (needs patent_horizon_test — see "API" section)
npm run test:watch    # test suite in watch mode
npm run test:coverage # test suite with coverage report
```

## Deploying

The recommended, boring path for a solo founder:

1. **App:** push to GitHub, import the repo on [Vercel](https://vercel.com/new).
   Zero-config for Next.js.
2. **Database:** create a managed Postgres instance on
   [Neon](https://neon.tech) or [Supabase](https://supabase.com) (both have
   generous free tiers), and set `DATABASE_URL` in Vercel's environment
   variables to the connection string they give you.
3. Run `npx prisma migrate deploy` (instead of `migrate dev`) against the
   production database when you ship schema changes — either manually or as
   a step in CI before deploy.
4. Set `BETTER_AUTH_SECRET` (a fresh one — don't reuse the dev value),
   `BETTER_AUTH_URL` (the real production URL, not `localhost`), and
   `ANALYST_EMAILS` in Vercel's environment variables too.

No servers to provision, no Dockerfiles to maintain for the app itself.

## Notes for future sessions (human or agent)

- The Prisma schema (`prisma/schema.prisma`) is the source of truth for the
  data model — start there when adding a table or field, then run
  `npx prisma migrate dev --name <description>`.
- `.claude/skills/` contains Prisma's official skill docs (CLI, client API,
  Postgres setup, etc.) for reference on exact v7 syntax, since Prisma 7 is
  new enough that older training data may suggest outdated patterns (e.g. no
  driver adapter, different client import path).
- Prisma Client is generated into `src/generated/prisma` and is git-ignored;
  it's regenerated automatically by `postinstall` and by `prisma migrate dev`.
- The `IngestionRecord` table has a hand-added `CHECK` constraint (exactly
  one of `drugId`/`patentId`/`exclusivityId` must be set) living in
  `prisma/migrations/20260813200111_init_patent_data_model/migration.sql`
  below the Prisma-generated SQL. It is not expressed in `schema.prisma`
  itself — see the "Data model" section above before touching that table.
- Adding or changing an API endpoint means updating three things together:
  the Zod schema in `src/lib/drugs/schemas.ts` (validation), the query
  function in `src/lib/drugs/queries.ts` (behavior), and — because the
  OpenAPI doc is generated from those same schemas — the docs update
  automatically. Add a corresponding path entry in
  `src/lib/openapi/spec.ts` for genuinely new endpoints. Write the test
  first if the change is behavioral, not just additive.
- Run `npm test` before considering any API change done — the suite runs
  against a real database and catches SQL bugs mocks would miss.
- New protected page → add `await requireUser()` (or `requireAnalyst()`)
  as the first line. New protected API route → add
  `await getSessionUser(request)` and return `unauthorizedResponse()` if
  null, as the first thing the handler does. Don't rely on `src/proxy.ts`
  alone — it's explicitly the optimistic check, not the real one (see
  "Accounts and access control").
- If `src/lib/auth.ts` changes (new plugin, new field), regenerate the
  auth schema with `npx auth generate --output /tmp/scratch.prisma` (do
  **not** point `--output` at `prisma/schema.prisma` directly — it will
  prompt to overwrite the whole file) and hand-merge the diff into the
  `User`/`Session`/`Account`/`Verification` models, the same way the
  `IngestionRecord` `CHECK` constraint above is preserved by never
  regenerating over it.
