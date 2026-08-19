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

**Entities:** `Company` → `Drug` (small molecules, FDA Orange Book — one
approved product: brand/generic name + dosage form + route + strength
under one FDA application) and `Company` → `BiologicProduct` (biologics,
FDA Purple Book — see below). `Patent` and `Exclusivity` belong to either
a `Drug` or a `BiologicProduct`. `DataSource` + `IngestionRecord` track
provenance across all four.

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
a fourth nullable FK column, not just a new enum value. That prediction
held exactly: adding `BiologicProduct` (below) meant a new nullable
`IngestionRecord.biologicProductId` column and extending the `CHECK`
constraint from 3-way to 4-way — a small, mechanical migration, not a
redesign.

### Extending to a second product type: `BiologicProduct`

Biologics (monoclonal antibodies, biosimilars, gene/cell therapies,
vaccines — FDA's Purple Book, see below) don't fit the `Drug` model:
different natural key semantics (`blaNumber`+`productNumber` vs.
`applicationNumber`+`productNumber`), a License Type/Center vocabulary
with no small-molecule analogue, and — the genuinely novel part — a
self-referential biosimilar/interchangeable/reference-product network
(`BiologicProduct.referenceProductId → BiologicProduct.id`) that doesn't
exist for NDA/ANDA drugs at all. Rather than force any of that onto
`Drug`, `BiologicProduct` is its own model, reusing `Company` (a firm can
hold both NDA/ANDA and BLA applications) and the shared `Modality` enum.

**`Patent` and `Exclusivity` are reused polymorphically instead** — both
gained a nullable `biologicProductId` alongside the existing `drugId`
(exactly one set, enforced by a hand-written `CHECK` constraint, same
pattern as `IngestionRecord`'s). Two concrete reasons this was reuse, not
just convenience:

1. A Purple Book patent-list entry is a real USPTO patent number — the
   existing PTA enrichment pipeline enriches by patent number alone and
   doesn't care what it's attached to. Sharing the table means biologic
   patents get real PTA enrichment with **zero new enrichment code** (see
   PTA section below).
2. `Exclusivity.code` was already documented as "a raw string because the
   vocabulary grows over time" — BPCIA codes (`BPCIA_REF_PRODUCT`,
   `BPCIA_FIRST_INTERCHANGEABLE`, `ORPHAN`) are new vocabulary in that same
   slot, not a new concept requiring a parallel table.

**A real gotcha this surfaced, worth knowing before adding a similar
polymorphic FK elsewhere:** a single compound unique index spanning *both*
nullable FK columns together (e.g. `@@unique([drugId, biologicProductId,
patentNumber])`) would silently enforce nothing for either side — Postgres
skips a row from a unique index's checking entirely as soon as any ONE of
that index's own columns is `NULL`, and every row has at least one of the
two always null by design. The fix isn't a partial index (tried first,
then simplified once this was understood) — it's just **two separate,
independent unique indexes**, each on its own FK: `@@unique([drugId,
patentNumber, useCode])` (unaffected — every Orange Book row's
`biologicProductId` is null, and that column isn't part of this index at
all) and `@@unique([biologicProductId, patentNumber])` (a new one, scoped
to its own non-null population the same way). Each index only "sees" rows
where all of its own columns are non-null, so the two never interfere.

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

## Data ingestion: FDA Purple Book

`npm run ingest:purple-book` populates `BiologicProduct` (and, where
disclosed, `Patent`/`Exclusivity`) from FDA's Purple Book — the biologics
counterpart to Orange Book: monoclonal antibodies, biosimilars, gene/cell
therapies, vaccines, and other biologic products regulated under a BLA
(Biologics License Application) rather than an NDA/ANDA.

### The source — researched directly, not assumed

Confirmed against the live site (`purplebooksearch.fda.gov`) before writing
any code, since FDA restructured Purple Book in recent years and stale
assumptions from general knowledge would have been wrong:

- **Product data**: a real monthly CSV/XLSX snapshot, same static-file
  hosting pattern as Orange Book —
  `accessdata.fda.gov/drugsatfda_docs/PurpleBook/{year}/purplebook-search-{Month}-data-download.csv`.
  Each monthly file has two sections (a change-log of that month's
  updates, then the full current snapshot); this pipeline reads only the
  full-snapshot section, by finding the *last* occurrence of the repeated
  header row. Unlike Orange Book's simple `~`-delimited format, this is
  real quoted-field CSV (`"Recombivax, Recombivax Hb"` — a proprietary
  name containing a literal comma) — hand-rolled RFC4180 parsing rather
  than a naive comma-split, and rather than adding a CSV-parsing
  dependency for a well-understood, bounded algorithm.
- **Patent data is a *separate*, much thinner source**, mandated by the
  2021 Biological Product Patent Transparency (BPPT) Act:
  `purplebooksearch.fda.gov/patent-list`. There is **no downloadable
  CSV/XLSX for this** — confirmed by checking the actual downloads page.
  The only place it exists is a server-rendered HTML `<table>`; the page's
  DataTables widget loads from that same table and paginates it
  client-side, it doesn't call a separate JSON API. So this pipeline
  scrapes that HTML directly — isolated in its own module
  (`purpleBook/parsePatentList.ts`) so a markup change there can never take
  down the far more valuable product ingestion. A plain fetch/curl with no
  User-Agent gets silently blocked by FDA's WAF (a 200 "FDA Apology" page,
  not an error status — easy to mistake for success); a standard browser
  User-Agent works.
- **No official API key or rate limit for either source** — same
  batch-download shape as Orange Book.

### How the pipeline works

```
src/lib/ingestion/purpleBook/
  types.ts            shared row/result types
  parseProducts.ts     product CSV -> typed rows, never touches the DB
  parsePatentList.ts   patent-list HTML -> typed rows, isolated from the above
  load.ts              typed rows -> DB (3-pass: companies+products, then
                        reference-product name resolution, then patents/exclusivities)
  index.ts             orchestration: fetch both sources, parse, load, write run summary
scripts/ingest-purple-book.ts   CLI entrypoint (npm run ingest:purple-book)
```

Same operating discipline as Orange Book: idempotent (`upsert` on the
natural key — `BiologicProduct[blaNumber,productNumber]`), never crashes on
a bad row (malformed rows logged to `issues`, not thrown), every run
writes an `IngestionRun` + per-entity `IngestionRecord`s, tagged with a
`"FDA Purple Book"` `DataSource` row distinct from Orange Book's. `--url
<csv-url>` overrides the auto-selected month (which tries the current
month, then automatically falls back to the prior month on a 404 — FDA
routinely hasn't published the current month's file yet); `--skip-patent-list`
skips the separate HTML scrape.

**Reference-product resolution is a genuine two-pass problem.** Purple
Book gives a biosimilar/interchangeable row its reference product's
*name* (`Ref. Product Proprietary/Proper Name`), not its BLA number — so
`load.ts` upserts every product first, builds a name→id map from what it
just wrote, then resolves `referenceProductId` in a second pass. Real
result: **236 of 236 resolvable reference-product links resolved
successfully** (100%) against the July 2026 snapshot. When resolution
*would* fail, the raw name is kept in `referenceProductNameRaw` rather than
silently dropped — nothing something didn't match ever just disappears.

### What the source data actually looks like (and what surprised me)

- **Patent coverage is genuinely thin — this is the honest answer to "how
  much real patent data does Purple Book give you."** Only **16 of 855
  distinct BLAs (1.9%)** have any patent disclosed at all, cross-checked
  two ways: the product CSV's own `Patent List Provided` flag (49 of 2,230
  product rows) and the separate patent-list page (424 total patent rows,
  all traceable to those same 16 BLAs). This isn't a pipeline gap — it's
  what the BPPT Act actually requires: a reference-product sponsor only has
  to disclose patents when an actual 351(k) biosimilar patent dance is
  triggered against them, not proactively for every licensed biologic. The
  other ~98% of biologic products simply have zero `Patent` rows on file,
  the same as an Orange Book generic with no listed patent — visible in
  the UI, not hidden.
- **The patent-list page was 14 months stale relative to the product
  database** at the time this was built (patent list last updated June
  2025; product database updated August 2026). Worth knowing if patent
  counts ever look surprisingly low for a biologic you'd expect to have
  recent disclosures.
- **The disclosed patent data is thinner per-record too, not just sparser
  overall**: `Reference Product BLA Number, Applicant, Proprietary Name,
  Proper Name, Patent Number, Patent Expiration Date` — no filing date, no
  use code, no substance/product coverage flags. Structurally, though,
  it's still a real USPTO patent number, so it goes through the *exact
  same* `Patent` table and `nominalExpiryDate = effectiveExpiryDate =
  <source date>, filingDate = null` starting state Orange Book patents get
  before PTA enrichment — meaning the existing PTA pipeline
  (`src/lib/ingestion/pta/`) picks these up as ordinary candidates with
  **zero new code**. 1,539 `Patent` rows currently exist from the 424 raw
  disclosures (one per BLA fans out to every product-strength row sharing
  that BLA, since the source has no product-level patent granularity).
- **BPCIA exclusivity is three distinct legal mechanisms, not one field**:
  12-year (+6mo pediatric) reference-product exclusivity, 1-year
  first-interchangeable exclusivity, and orphan-drug exclusivity — three
  separate date columns in the source, loaded as three distinct
  `Exclusivity.code` values (`BPCIA_REF_PRODUCT`,
  `BPCIA_FIRST_INTERCHANGEABLE`, `ORPHAN`) rather than force-fit into one.
  First-interchangeable exclusivity can legitimately be the literal string
  `"Date TBD"` (FDA has determined eligibility but not yet the period) —
  handled as an expected, unlogged case, not an error.
- **Two real bugs were caught only by manually sanity-checking a live API
  response against a real drug (Keytruda), not by the isolated checks that
  produced the fixes they were checking**, worth internalizing as a
  pattern: (1) a 2-digit-year century pivot (`"25-Jan-31"` → year 31) was
  set at a threshold of 30 based on checking only two date columns; the
  true range across all five date columns is 00-32/64-99, so a real future
  date (2031) was silently stored as 1931 until caught by the estimated
  entry date showing "Jan 1931" for a product approved in 2014. (2) The
  long-month-name date format (`"January 4, 2031"`) was parsed via a plain
  `new Date(...)`, which resolves in the *server's local timezone* — every
  date-only value needs re-anchoring to UTC midnight of the parsed
  calendar date, or the same ingestion run produces different stored
  instants depending on where it's deployed. Both are covered by
  regression tests now (`tests/purple-book-parse.test.ts`,
  `tests/purple-book-patentlist-parse.test.ts`) — the second bug
  specifically only surfaces as a failing test asserting an *exact* UTC
  timestamp, not as a wrong calendar date, which is why the original
  real-data spot-check didn't catch it.
- **3 of 2,230 product rows have a genuinely blank Proprietary Name in
  FDA's own data** — three antivenin products approved in 1936/1967
  (`Antivenin (Latrodectus mactans)`, `Antivenin (Micrurus fulvius)`).
  Skipped and logged, not a parsing bug.

### Result of the first real run

| Entity | Count |
|---|---|
| Biologic products | 2,227 (of 2,230 raw rows — 3 skipped, see above) |
| Patents | 1,539 (from 424 raw disclosures, fanned out across product-strength rows) |
| Exclusivities | 636 (36 reference-product, 30 first-interchangeable, 570 orphan) |
| Reference products resolved | 236 / 236 (100%) |

## Data ingestion: FDA Paragraph IV Certifications List

`npm run ingest:paragraph-iv` loads FDA's Paragraph IV Patent
Certifications List — a signal the app's own patent/exclusivity math is
otherwise silent about: whether a generic company has actually filed a
patent challenge against a drug, and whether that's already resulted in
real generic entry, possibly *before* the computed expiry date shown
elsewhere in this product.

### The source — researched directly, not assumed

`fda.gov/drugs/abbreviated-new-drug-application-anda/patent-certifications-and-suitability-petitions`
blocks non-browser fetches the same way Purple Book's downloads do (a
plain `curl`/`fetch` 404s; a browser-like `User-Agent` works). The page's
actual download link is under a "New Paragraph IV Certifications" heading
— not the "Paragraph IV Certifications List" heading that describes the
columns — and its URL (currently `/media/166048/download`) changes
whenever FDA republishes, so this doesn't hardcode it: it scrapes the
parent page each run for a link whose text matches "Paragraph IV Patent
Certifications" and downloads whatever URL is there. A separate, much
smaller HTML table also lives on that page under the same heading (5
columns, ~9 rows, the very newest submissions not yet folded into the
PDF) — deliberately **not** ingested, since it's a preview of the same
data with none of the 180-day-status/marketing-date fields, not a second
source.

The PDF itself has no exposed table markup. FDA renders every cell with
an invisible clip-path rectangle (to keep wrapped text from bleeding into
the next column) at pixel-identical column positions on every page —
confirmed directly across pages 1, 2, 50, and 96 of a real download. The
parser (`src/lib/ingestion/paragraphIV/parsePdf.ts`) reads those clip
rectangles via `pdfjs-dist`'s operator list as the authoritative row/
column geometry, deriving both the column boundaries and the header/body
divider from the PDF's own header row at parse time rather than
hardcoding pixel constants, so a minor future FDA template tweak fails
loudly (a clear error) instead of silently mis-parsing. This was validated
against a full real download before being trusted: reconstructed row
count matched a reference extraction exactly (1,632/1,632), with
byte-identical cell content on 1,626/1,632 rows (the other 6 differed only
by a missing inter-word space).

### Edge cases confirmed directly against a real download

- **Non-date submission values**: `Pre-MMA` (241 rows) and `PIV received
  prior to <date>` (6 rows) are both real, FDA-defined states — parsed
  into a `submissionDateType` discriminant (`EXACT_DATE` /
  `PRE_MMA` / `RECEIVED_PRIOR_TO`), never treated as a parse failure or
  left as an unexplained null. A `Pre-MMA` row's blank downstream columns
  (ANDA count, 180-day status, dates) are "not applicable by definition"
  (FDA's own text: per-patent submission dates aren't tracked under the
  pre-2003 statutory scheme) — not logged as an issue, unlike a genuinely
  blank column on a row with a real submission date (an open/unresolved
  challenge, also not an issue — just `null`, the same convention as
  `Patent.expiryAdjustmentDays`).
- **Multi-value stacked cells**: the 180-Day Status and Posting Date
  columns can stack multiple entries (`"Extinguished\nEligible"`),
  most-recent-first per FDA's own stated ordering — stored as an ordered
  `decisionHistory` array. Entry count between the two columns doesn't
  always match 1:1 (5 real rows have a status with no corresponding
  posting date) — paired positionally, with a missing date left `null`
  rather than assumed. One row (Vasopressin/Vasostrict) embeds a
  per-strength qualifier directly in the status text
  (`"40 u/100 mL -\nExtinguished"`, wrapped across two lines) — the parser
  coalesces a keyword-less line into the next line before treating it as
  one entry, so this resolves to one `EXTINGUISHED` entry with the
  qualifier preserved in `rawStatusText`, not two bogus entries. The same
  ragged-multi-value problem hits the marketing-date and expiration-date
  columns in ~10 rows total, with genuinely inconsistent formatting across
  rows (separator `-` vs `:`, strength before *or* after the date) — the
  parser only accepts the single-unambiguous-date case and otherwise
  leaves the field `null`, preserves the raw text in `rawNotes`, and logs
  a `RowIssue`, rather than guessing which date belongs to which strength.
- **Multi-strength rows**: one PDF row can legitimately list several
  strengths under one RLD/NDA (e.g. Nucynta ER's `"50 mg, 100 mg, 150 mg,
  200 mg, and 250 mg"`) — resolved by linking to every matching `Drug` row
  under that NDA number rather than guessing down to one (see matching
  strategy below).
- **RLD/NDA cell, two more real cases found during development**: the
  brand name can wrap across up to 9 lines before the trailing number
  (`"Excedrin\n(migraine)\n20802"`), a few rows prefix the number with a
  literal `"NDA "` (`"Bijuva\nNDA 210132"`), and **79 rows (4.8%) have no
  number at all** — just a bare brand name (`"Pepcid"`, `"Tequin"`,
  `"Gemzar"`), almost entirely old Pre-MMA entries where FDA's own
  historical record is incomplete. These are logged as unmatched with an
  explicit reason, never guessed via brand-name fuzzy matching — too weak
  a signal to trust silently.

### Domain model

`GenericChallenge` is not a `Patent` and not an `Exclusivity` — it's a
filing/status record about *other parties'* applications against the
RLD's patents, not a record that itself defines a legal term. Linked to
`Drug` through a many-to-many join table (`GenericChallengeDrug`), not a
nullable FK on either side: confirmed directly that one PDF row's strength
list can resolve to several real `Drug` rows (Nucynta ER → 5 rows across
`productNumber` 001–005), which a single FK couldn't represent. Decision
history is stored as an ordered JSON array (matching how
`IngestionRun.summary` already uses `Json` for a structured-but-not-
independently-queried shape), with `currentStatus` denormalized out for
the one thing actually filtered/displayed. Deliberately ANDA/505(j)-only —
biosimilars use the separate BPCIA patent-dance process, already tracked
via Purple Book's own patent list, so this never links to
`BiologicProduct`.

`GenericChallenge`'s natural key uses a `naturalKeyNda` sentinel column
(`rldNdaNumber ?? "NO_NDA:" + rldName`), not the nullable `rldNdaNumber`
column directly, in its `@@unique` constraint — Postgres treats every
`NULL` as distinct, so a compound unique index containing a nullable
column silently stops deduplicating any row where that column is null.
Caught before it shipped: the ~5% of rows with no NDA number would have
re-inserted as a brand-new row on every re-ingestion instead of upserting
in place. Same sentinel pattern already used for `Patent.useCode`'s
`@default("")`, for exactly the same reason.

### Product-matching strategy

Primary match: normalize the RLD/NDA cell's trailing number (strip an
optional `"NDA "` prefix, zero-pad to 6 digits, prepend `"NDA"`) and query
every `Drug` row sharing that `applicationNumber` — not just one, since a
challenge can legitimately span several strength rows under one NDA. When
the matched set spans more than one distinct `dosageForm` (same NDA,
different dosage forms), it's narrowed by case-insensitive token overlap
between the PDF's dosage-form text and each `Drug`'s own (the two sides
use different word order/casing/pluralization — confirmed directly, e.g.
"Extended-release Tablets" vs `"TABLET, EXTENDED RELEASE"`); if that
doesn't cleanly resolve, the full unnarrowed set is kept and a `RowIssue`
is logged rather than guessing. Strength itself is never matched at the
individual-SKU level — both sides use incompatible free-text formats
(PDF: `"300 mg"`; Orange Book: `"EQ 300MG BASE **Federal Register
determination...**"`), and a challenge fundamentally describes the RLD's
patent estate at the dosage-form grain, not per strength, in FDA's own
list design.

### Result of the first real run (2026-08-19)

| Metric | Count |
|---|---|
| Raw rows parsed from PDF | 1,632 |
| Challenges upserted | 1,627 (5 deduplicated as literal repeats) |
| Matched to ≥1 `Drug` | 1,540 (94.6%) |
| Unmatched — no RLD/NDA number in source | 79 |
| Unmatched — RLD/NDA number not found in current Orange Book data | 8 |
| `GenericChallengeDrug` links created | 4,565 |
| Row-level issues logged | 183 (grouped into 18 categories, see the CLI output for the full breakdown) |

How much of this reflects *real, resolved* generic competition, not just
a filed challenge: of the 1,540 matched challenges, a real
`dateOfFirstCommercialMarketing` is on file for a meaningful subset, and
some of those genuinely predate the drug's own computed expiry estimate —
exactly the divergence this feature exists to surface (see the "Generic
entry occurred before the computed expiry date" flag on a drug's detail
page). Run `npm run ingest:paragraph-iv` yourself and check `/data` or the
CLI summary for current numbers; they shift with every FDA republish.

**FDA's own caveat, stated directly on the source page**: the agency's
regulatory decisions are based on the underlying applications, not this
published list — the list can lag or occasionally diverge from ground
truth. This app inherits that caveat as-is; `expirationOfLastQualifyingPatent`
in particular is shown as reference-only on a drug's detail page, never as
a replacement for the drug's own computed `effectiveExpiryDate` (FDA's own
definition of that column excludes pediatric exclusivity and reflects only
PIV-certified patents, not the drug's full protection picture).

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

**This pipeline now also enriches Purple Book patents, with zero code
changes.** Candidate selection queries `Patent` generically (any row
lacking an `IngestionRecord` from this `DataSource`) — it was never keyed
on `drugId` specifically, so once `Patent.biologicProductId` existed as an
alternate parent, biologic-linked patents became ordinary candidates
automatically. Verified directly: of 22,794 total un-enriched candidates,
1,539 are biologic-linked and are selected identically to the 21,255
drug-linked ones. (The USPTO ODP API key currently on file is failing
auth — see [Notes for future sessions](#notes-for-future-sessions-human-or-agent)
— so this hasn't been demonstrated with a live enrichment run yet, but the
wiring is in place and verified up to that point.)

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
entry opportunities before competitors do." Six endpoints, all `GET`, all
JSON (except the CSV export).

**Browse the interactive docs at `/docs`** (run `npm run dev`, then open
[http://localhost:3000/docs](http://localhost:3000/docs)) — a full Swagger/Scalar-style reference with
try-it-now requests and generated code samples in several languages. The
raw spec is at `/api/openapi.json`.

### `GET /api/drugs` — unified list / search, ranked by soonest generic entry

Spans **both** small-molecule drugs (Orange Book) and biologics (Purple
Book) in one ranked, paginated result set — see
[Advanced search](#advanced-search) for how. Every result carries
`estimatedGenericEntryDate` (the latest expiry date among that result's
currently-listed patents and exclusivities, computed in the database, not
fetched-then-computed in JS) and `source` (`orange_book` / `purple_book`,
telling you which detail endpoint to follow). Results with no listed
patent or exclusivity at all are excluded — nothing to report.

| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string, 1-200 chars | — | Substring match against name, alternate name, or company/applicant name, case-insensitive |
| `withinDays` | integer, 0-36500 | — | Only results whose estimate falls within this many days from now. No lower bound — already-past estimates are included too |
| `expiresAfter` / `expiresBefore` | date (`YYYY-MM-DD`) | — | Explicit generic-entry date-range bounds, inclusive |
| `modality`, `drugClass`, `applicationType`, `dosageForm`, `route`, `applicant`, `source`, `patentType`, `exclusivityCode` | comma-separated | — | Multi-value — OR within one param, AND across params. See [Advanced search](#advanced-search) |
| `minPtaGapDays` | integer, ≥0 | — | Only results with a patent whose PTA correction is at least this many days — see [Advanced search](#advanced-search) |
| `sort` | `entry_asc` \| `entry_desc` \| `pta_gap_desc` | `entry_asc` | Soonest-first by default |
| `limit` | integer, 1-100 | 20 | Page size |
| `offset` | integer, ≥0 | 0 | Pagination offset |

```bash
curl "http://localhost:3000/api/drugs?withinDays=180&limit=10"
curl "http://localhost:3000/api/drugs?q=eliquis"
curl "http://localhost:3000/api/drugs?source=purple_book&modality=MONOCLONAL_ANTIBODY"
curl "http://localhost:3000/api/drugs?minPtaGapDays=150&sort=pta_gap_desc"
```

```json
{
  "data": [
    {
      "id": "...", "source": "orange_book",
      "name": "ELIQUIS", "alternateName": "APIXABAN",
      "applicationType": "NDA", "licenseType": null,
      "dosageForm": "TABLET", "route": "ORAL", "strength": "2.5MG",
      "approvalDate": "2012-12-28",
      "modality": "SMALL_MOLECULE", "drugClass": null,
      "company": { "id": "...", "name": "BRISTOL MYERS SQUIBB CO..." },
      "estimatedGenericEntryDate": "2031-08-24",
      "patentCount": 12, "exclusivityCount": 2, "maxPtaGapDays": 411
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "total": 50729, "hasMore": true },
  "facets": {
    "modality": [{ "value": "SMALL_MOLECULE", "count": 47761 }, { "value": "MONOCLONAL_ANTIBODY", "count": 129 }],
    "source": [{ "value": "orange_book", "count": 2847 }, { "value": "purple_book", "count": 637 }]
  }
}
```

### `GET /api/drugs/:id` — full detail on one Orange Book drug

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

`404` (structured, see below) if the id doesn't exist. A biologic id (from
a `/api/drugs` result with `source: "purple_book"`) 404s here — use
`GET /api/biologics/:id` instead.

`genericChallenges` (usually empty — see the Paragraph IV section above
for real match-rate numbers) carries any linked FDA Paragraph IV filing:
current 180-day status, decision history, and — critically —
`dateOfFirstCommercialMarketing` shown as its own field, never merged into
`genericEntryEstimate`. The web UI flags it distinctly when that date
predates the computed estimate ("generic entry occurred before the
computed expiry date").

### `GET /api/biologics/:id` — full detail on one Purple Book biologic

Same shape as the drug detail endpoint (patents, exclusivities,
`genericEntryEstimate`), plus the BPCIA biosimilar network:
`referenceProduct` (resolved, if matched), `referenceProductNameRaw` (the
source's raw name when it couldn't be resolved — never silently dropped),
and `biosimilarsAndInterchangeables` (products that reference this one).

```bash
curl "http://localhost:3000/api/biologics/<id>"
```
```json
{
  "data": {
    "id": "...", "proprietaryName": "Cyltezo", "properName": "adalimumab-adbm",
    "licenseType": "INTERCHANGEABLE", "center": "CDER",
    "referenceProduct": { "id": "...", "proprietaryName": "Humira", "properName": "adalimumab" },
    "referenceProductNameRaw": null,
    "biosimilarsAndInterchangeables": [],
    "patents": [], "exclusivities": [ { "code": "BPCIA_FIRST_INTERCHANGEABLE", "expirationDate": "2023-04-15", "...": "..." } ],
    "genericEntryEstimate": { "date": "2023-04-15", "controllingType": "exclusivity", "...": "..." }
  }
}
```

### `GET /api/search/autocomplete` — name suggestions across both sources

```bash
curl "http://localhost:3000/api/search/autocomplete?q=hum"
```
```json
{ "data": [{ "id": "...", "source": "purple_book", "name": "Humira", "alternateName": "adalimumab" }] }
```

### `GET /api/drugs/export` — CSV of the current filtered results

Same filters as `GET /api/drugs`; `limit`/`offset` are ignored (everything
matching, up to a 50,000-row safety cap). Returns `text/csv` with a
`Content-Disposition: attachment` header.

```bash
curl "http://localhost:3000/api/drugs/export?minPtaGapDays=150" -o export.csv
```

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

- **The list query is one SQL statement, not N+1 — and now one statement
  across two tables, not two statements merged in JS.** A `combined` CTE
  `UNION ALL`s a per-source sub-select (each computing
  `estimated_generic_entry_date` via `GREATEST(MAX(patent dates),
  MAX(exclusivity dates))` with its own `GROUP BY`), then the outer query
  filters, sorts, and paginates on that one normalized result set, with
  `count(*) OVER()` getting the total row count in the same round trip.
  Merging two already-paginated/sorted lists in JS wouldn't paginate or
  sort correctly across the combined set; building it any other way at
  all — fetch everything, filter/sort in JS — wouldn't scale past a few
  hundred rows.
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
npm run test:coverage # with coverage (91% statements as of writing)
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

## Drug classification

`/api/drugs` filters on structural drug type (`modality`) and best-effort
therapeutic class (`drugClass`) for both Orange Book drugs and Purple Book
biologics — neither field exists in either source, so both are derived
from the product's name.

### How classification works

Names are classified using real pharmaceutical naming-stem conventions
([INN/USAN](https://www.who.int/teams/health-product-and-policy-standards/inn)
— the standardized suffix system drug names follow: every monoclonal
antibody name ends in `-mab`, every statin in `-statin`, every cell therapy
in `-cel`, and so on) — sourced from the actual WHO INN Stem Book and the
AMA's 2021 nomenclature updates, not invented ad hoc, and every stem
checked against this project's real data (~2,700 distinct Orange Book
`genericName` values, 658 distinct Purple Book `Proper Name` values)
before being added:

- **`modality`** ([`src/lib/classification/modality.ts`](src/lib/classification/modality.ts))
  — a small, fixed, shared taxonomy (the `Modality` enum, used by both
  `Drug` and `BiologicProduct`): `SMALL_MOLECULE`, `PEPTIDE`,
  `OLIGONUCLEOTIDE`, `MONOCLONAL_ANTIBODY`, `CELL_THERAPY`, `GENE_THERAPY`,
  `VACCINE`, `OTHER`, `UNCLASSIFIED`.
- **`drugClass`** ([`src/lib/classification/drugClass.ts`](src/lib/classification/drugClass.ts))
  — an open-ended, best-effort mechanism/therapeutic tag (`"Statin"`,
  `"ACE inhibitor"`, `"Clotting factor"`, `"Immunoglobulin"`, ...),
  nullable free text rather than an enum, for the same reason
  `Exclusivity.code` is a free string. A drug can plausibly belong to more
  than one class; the schema stores one best-effort tag, so the first
  matching rule (in priority order) wins.

Both are **heuristics, not authoritative**. The matching engine picks the
**longest/most specific matching stem across the whole name**, not just
whichever rule happens to be checked first — this matters for real
combination cases: `"elivaldogene autotemcel"` (a real approved gene
therapy) has one token ending in the gene-therapy stem `-gene` (4 chars)
and another ending in the cell-therapy stem `-cel` (3 chars); the longer,
more specific match wins, which is also how FDA itself categorizes these
ex-vivo gene-modified-cell products. Real naming collisions were caught by
checking against actual data, the same discipline as before:

- Naive substring matching on `-rsen` (the oligonucleotide stem) matched
  **"ARSENIC TRIOXIDE"** — fixed by matching stems only as token suffixes
  ([`tokenize.ts`](src/lib/classification/tokenize.ts)), never a substring
  anywhere in the raw string.
- `-statin` alone would also tag **cilastatin**, **nystatin**, and
  **pentostatin** — real drugs that coincidentally end in "statin" without
  being statins. Excluded explicitly per stem rule.
- The real CAR-T infix **`-cabtagene`** (axicabtagene, brexucabtagene,
  ciltacabtagene, idecabtagene, lisocabtagene, obecabtagene — six real
  approved CAR-T therapies, all FDA-labeled cell therapy) happens to end in
  the same four letters as the gene-therapy `-gene` stem. Resolved without
  a special-case exclusion: `-cabtagene` is declared as its own, longer,
  more specific stem (9 chars vs. 4), so it already wins under the
  longest-match rule.

**Preprocessing before matching**: a bounded, known list of ~40 common
salt/ester-form and hydration-state modifier words (`sodium`,
`hydrochloride`, `besylate`, `monohydrate`, ...) is stripped before
matching, since these are appended to the active-ingredient name and would
otherwise become their own unclassifiable (or stem-colliding) token — e.g.
`"atorvastatin CALCIUM"` correctly still matches the `-statin` stem after
`calcium` is stripped. Combination products (multiple active ingredients)
need no special handling beyond this — the tokenizer already flattens
every ingredient's words into one list, and the longest-match rule checks
all of them.

### The fallback is source-aware — this was a real bug, now fixed

`classifyModality(name, fallback)` takes its "nothing matched" fallback as
a parameter rather than hardcoding it, because "no stem matched" means
something different depending on where the name came from:

- **Orange Book** (NDA/ANDA, small-molecule regulatory pathway): the
  pathway itself is strong evidence of small-molecule chemistry, so "no
  stronger signal" genuinely does mean `SMALL_MOLECULE` in the vast
  majority of real cases. Ingestion passes `fallback: "SMALL_MOLECULE"`.
- **Purple Book** (BLA, biologics pathway): the product is *definitely not*
  a small molecule — clotting factors, immunoglobulins, allergenic
  extracts, antivenoms have no distinct INN suffix of their own, but they
  are unambiguously biologics. Assuming `SMALL_MOLECULE` here would be
  actively wrong, not just imprecise. Ingestion passes `fallback:
  "UNCLASSIFIED"` — an honest "no confident tag," not a wrong guess.

This is the actual origin of the `UNCLASSIFIED` enum value: previously
(before Purple Book existed) the fallback was unconditionally
`SMALL_MOLECULE`, which only ever looked correct because the classifier had
only ever seen Orange Book data. A keyword-based supplement (matching a
whole token, not a suffix — the same mechanism `VACCINE` already used for
the literal word "vaccine") catches four more real, dominant Purple Book
categories that have no naming-stem convention at all (clotting factors,
immunoglobulins, allergenic extracts, antivenoms/antitoxins), bucketed as
`OTHER` rather than left unclassified — the same reasoning already applied
to Orange Book's heparinoids. Real result after backfilling every existing
row (`npm run classify:drugs`, safe to re-run any time — see below):

| Source | Unclassified before | Unclassified after |
|---|---|---|
| Orange Book (48,502 drugs) | 0.0% | 0.0% (0 rows changed — the engine rewrite didn't affect small-molecule outcomes) |
| Purple Book (2,227 biologics) | 80.6% | 64.7% (354 rows moved to a real `OTHER`/class tag) |

64.7% still unclassified for Purple Book is reported honestly, not
massaged down further — it reflects real biologic categories (specific
clotting-factor variants, named allergen panels, blood/plasma products,
...) that genuinely don't follow a detectable naming convention, not a
classifier shortfall worth chasing with more special-casing.

### Real biologics are now classified correctly — no longer a documented gap

Searching `modality=MONOCLONAL_ANTIBODY` now returns real results —
**213** as of the current ingestion (Keytruda, Humira, Dupixent, and
others) — now that Purple Book is ingested (see
[Data ingestion: FDA Purple Book](#data-ingestion-fda-purple-book)). This
used to be a documented, permanent zero-result gap; it's the concrete
payoff of adding the second source.

Existing rows are backfilled with `npm run classify:drugs`, which now
covers **both** `Drug` and `BiologicProduct` (using the correct
source-specific fallback for each) — safe to re-run any time, e.g. after
adding a new stem rule; it always recomputes from the current name, never
accumulates drift. Supports `--dry-run` and `--limit N`.

## Advanced search

`GET /api/drugs` (and the "Advanced" panel in the web UI) searches and
filters across **both** sources at once — `Drug` and `BiologicProduct` —
ranked and paginated together, not as two separate lists.

### How it's unified across two tables

`listDrugs()` ([`src/lib/drugs/queries.ts`](src/lib/drugs/queries.ts))
builds one `combined` CTE: a `UNION ALL` of a per-source sub-select, each
computing the same `estimated_generic_entry_date` / `patent_count` /
`exclusivity_count` / `max_pta_gap_days` aggregation against that source's
own `Patent`/`Exclusivity` rows, normalized into one shared shape
(`SearchResultSchema` — `source`, source-neutral `name`/`alternateName`
rather than force-fitting Orange Book's own field names onto biologics,
and two source-specific, mutually-exclusive fields — `applicationType` and
`licenseType` — rather than force-fitting one vocabulary onto the other).
The same filter/sort/pagination logic then applies uniformly regardless of
which table a result came from. Detail pages stay **separate**
(`GET /api/drugs/:id` vs. `GET /api/biologics/:id`) — their actual shapes
genuinely differ (license type, the reference-product network) — unifying
the *list* but not force-fitting the *detail* view.

### Filters — AND across categories, OR within one

Every filter below accepts a comma-separated list of values (OR within
that filter); separate filters combine with AND. `modality`, `drugClass`,
`applicationType`, `dosageForm`, `route`, `applicant`, `source`,
`patentType`, `exclusivityCode` all work this way — a genuine upgrade from
single-value equality filtering, since e.g. "peptides OR monoclonal
antibodies, from either source" is a real, useful query. `patentType`
(`substance`/`product`/`use`) and `exclusivityCode` are `EXISTS` subqueries
against `Patent`/`Exclusivity`, not plain column filters, since they
depend on a result's *children*, not its own row. `expiresAfter` /
`expiresBefore` (an explicit date range) and `withinDays` (the UI's quick
horizon chips) both filter the same underlying estimate and can combine.

`hasGenericChallenge` and `hasFirstCommercialMarketingDate` are
presence-only toggles (`?hasGenericChallenge=true`, omit for no filter),
not comma-separated lists — each is a plain "does at least one exist"
question, not a multi-value category. Both are Orange Book only (see "Data
ingestion: FDA Paragraph IV Certifications List") — Purple Book results
never match either.

### The PTA gap filter — made prominent, not buried

`minPtaGapDays` is the single clearest demonstration of this product's
entire reason to exist: it filters on `expiryAdjustmentDays` (already
computed per-patent, just never exposed as a filter before). It gets
first-class UI treatment to match — its own visible table column (color-
coded, not a small muted number), a dedicated `sort=pta_gap_desc` option,
and a green-highlighted input in the filter panel — rather than living as
one filter among nine others. Real example: filtering `minPtaGapDays=150`
finds **Pradaxa** (dabigatran) and **Kisqali** (ribociclib) with real
+181-day and +184-day corrections verified live against the running app.

### Autocomplete

`GET /api/search/autocomplete?q=...` — Postgres trigram (`pg_trgm`)
similarity search across both sources' name columns
(`migration 20260814190000_add_search_extensions` adds the extension and
GIN indexes). Results are de-duplicated by name (`DISTINCT ON`) before
ranking — a brand name can repeat across 10+ strength/presentation rows
(Humira alone), and a dropdown showing the same name ten times isn't a
useful suggestion list; the raw `id` returned is one real, navigable row
for that name, not the only one.

**Search infra decision: stayed on Postgres, no dedicated search
service.** Combined row count is ~50,700 (48,502 Orange Book + 2,227
Purple Book) — two orders of magnitude below where a separate search
service's relevance/scale features would earn their operational cost (a
second service to deploy, monitor, keep in sync) for what's fundamentally
prefix/substring name lookup in an internal analyst tool, not consumer
full-text search. `pg_trgm` gives typo-tolerant matching with a plain
Postgres extension and no new infrastructure. Revisit this if row count
grows by 10-100x or genuine relevance ranking becomes a real requirement.

### Faceted result counts

Every `/api/drugs` response includes `facets`: result counts per value for
five filter dimensions (`modality`, `source`, `applicationType`,
`dosageForm`, `route`), each scoped by every *other* currently-active
filter (its own filter is excluded from its own count query, so picking a
value shows what the *other* options would leave, not a frozen snapshot).
Deliberately **not** computed for `patentType`/`exclusivityCode` (`EXISTS`-
based, not a plain column) or `applicant`/`drugClass`/`exclusivityCode`
(free-text/high-cardinality) — a scope cut, not an oversight: each facet
query re-materializes the full `combined` CTE (acceptable at this data
volume; revisit with a materialized view if that ever changes), so the
facet set is limited to the dimensions an analyst actually scans while
narrowing results.

### CSV export

`GET /api/drugs/export` accepts the exact same filters as `/api/drugs`
(everything except `limit`/`offset`, which are overridden internally —
this streams *every* matching row up to a 50,000-row safety cap, not one
page) and reuses the identical query-building code, so the exported rows
always exactly match whatever's on screen.

### `GET /api/drugs/filter-options` — current filter vocabulary

Powers the advanced-search UI's inputs. Fixed vocabularies (`modalities`,
`applicationTypes`, `source`, `patentTypes`) return every possible value,
including ones with zero current matches (e.g. `applicationType=BLA` is
still offered even though Orange Book itself never has one — the same
"ready for when the data shows up, not hidden because it's currently
empty" reasoning as `MONOCLONAL_ANTIBODY` used to require, before Purple
Book made it moot). `dosageForm`/`route`/`applicant` are genuinely
open-ended free text, combined live across both sources (117 distinct
dosage forms as of writing); `exclusivityCode` is a live, growing
vocabulary spanning Orange Book codes (`NCE`, `ODE-*`, `PED`, ...) and the
new BPCIA codes together.

## Web UI

The primary screen — `/` — is the thing a pharma business analyst is meant
to have open daily: a dense, sortable, filterable table spanning both
small-molecule drugs and biologics with a known patent or exclusivity,
ranked by estimated generic-entry date. Clicking a row opens the full
picture for that result — `/drugs/:id` for a drug, `/biologics/:id` for a
biologic — every patent and exclusivity, and the same transparent
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
  of the screen — every filter (modality, drugClass, applicationType,
  source, patentType, dosageForm, route, applicant, exclusivityCode,
  date-range, minPtaGapDays) is just more query params, so an advanced-
  filtered view is bookmarkable like any other. The panel auto-expands on
  load if any of those params are already set (e.g. from a shared link),
  and its toggle button shows a count badge of how many advanced filters
  are active. Select options come from `GET /api/drugs/filter-options`,
  fetched server-side alongside the results themselves — no client-side
  waterfall for the filter UI either.
- **One reusable `MultiSelectFilter` component powers all nine filter
  dimensions**, not nine one-off implementations — a popover with a
  search-to-narrow box (useful past a couple dozen options, e.g.
  dosageForm's 117 or exclusivityCode's ~470) and a checkbox per option,
  each annotated with its live facet count so picking a value shows what
  it would actually leave, not just its name.
- **The PTA gap gets a real column, not a buried filter** — the same
  "make it prominent" principle the API design applies: a dedicated,
  color-coded `PTA Gap` column between the patent/exclusivity counts and
  the entry date, its own click-to-sort header, and a green-highlighted
  filter input, since it's the single clearest demonstration of what this
  product is for.
- **Autocomplete suggests, the debounced search commits** — two related
  but distinct behaviors on the same input: typing triggers a 300ms-
  debounced dropdown of name suggestions (`GET /api/search/autocomplete`)
  *and* commits the raw text as the `q` filter; picking a suggestion
  short-circuits straight to a committed search for that exact name.
- **Source and license-type badges make provenance visible at a glance** —
  every row shows which FDA publication it came from and, for biologics,
  its BPCIA license type (351(a) / biosimilar / interchangeable),
  distinct-but-adjacent to the existing NDA/ANDA/BLA badge that only
  applies to the Orange Book side.
- **CSV export is a plain link, not a client-side download** — `<a
  href="/api/drugs/export?...">` with the current URL's query string
  carried straight through; the server's `Content-Disposition` header
  triggers the browser's normal download flow, so the exported file always
  exactly matches whatever filters are currently applied on screen.
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

`npm test` includes `tests/auth.test.ts` (158 tests total across the full
suite as of writing): the analyst-allowlist logic as pure-function unit tests (not an
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
src/app/(home)/page.tsx    Primary screen: unified patent-expiration table (route group — see "Web UI")
src/app/drugs/[id]/        Drug detail screen: full patent/exclusivity picture
src/app/biologics/[id]/    Biologic detail screen: same, plus the BPCIA reference-product network
src/app/login/, signup/    Sign in / create account pages
src/app/team/              Analyst-only user management (page.tsx + Server Actions in actions.ts)
src/app/data/              Analyst-only ingestion/enrichment status page — see "Operating this yourself"
src/app/api/auth/[...all]/ Better Auth's own routes (sign-in, sign-up, session, admin ops, ...)
src/app/api/health/        GET /api/health — DB connectivity check
src/app/api/drugs/         GET /api/drugs (unified search), /[id], /filter-options, /export
src/app/api/biologics/     GET /api/biologics/[id] — biologic detail
src/app/api/search/        GET /api/search/autocomplete
src/app/api/openapi.json/  Serves the generated OpenAPI 3.1 spec
src/app/docs/              Interactive API docs (Scalar), reads the spec above
src/proxy.ts               Optimistic signed-out redirect (Next 16's "middleware", renamed)
src/components/auth/       Login/signup forms, header user menu, team management table
src/components/drugs/      UI: table, filter bar (incl. MultiSelectFilter), detail-page cards, badges
src/lib/auth.ts            Better Auth server config (roles, hooks, plugins)
src/lib/auth-client.ts     Better Auth client (used by login/signup/team UI)
src/lib/session.ts         requireUser()/requireAnalyst()/getSessionUser() — the real access control
src/lib/analystAllowlist.ts  Pure allowlist logic behind ANALYST_EMAILS (unit-tested separately)
src/lib/prisma.ts          Shared Prisma client singleton
src/lib/format.ts          Date/relative-time/urgency formatting shared by the UI
src/lib/api/               Shared API infra: error envelope, query-param parsing
src/lib/drugs/             Zod schemas + unified search/detail queries backing the API and UI
src/lib/classification/    Modality/drugClass heuristics, shared by both ingestion pipelines
src/lib/openapi/           Builds the OpenAPI doc from the Zod schemas above
src/lib/ingestion/shared.ts     mapWithConcurrency/dedupeByKey — shared by both pipelines below
src/lib/ingestion/orangeBook/   Orange Book (small-molecule) ingestion pipeline
src/lib/ingestion/purpleBook/   Purple Book (biologics) ingestion pipeline — product CSV + patent-list HTML
src/lib/ingestion/paragraphIV/  Paragraph IV generic-challenge ingestion — PDF scrape/parse/load
src/lib/ingestion/pta/     USPTO Patent Term Adjustment enrichment (client/enrich/orchestrate) — both sources
scripts/ingest-orange-book.ts   CLI entrypoint: npm run ingest:orange-book
scripts/ingest-purple-book.ts   CLI entrypoint: npm run ingest:purple-book
scripts/ingest-paragraph-iv.ts  CLI entrypoint: npm run ingest:paragraph-iv
scripts/enrich-pta.ts      CLI entrypoint: npm run enrich:pta
scripts/classify-drugs.ts  CLI entrypoint: npm run classify:drugs (both sources)
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

## Operating this yourself

The day-to-day loop for whoever owns this product — no code changes needed for any of it.

1. **Start the site.**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). (For a production deploy, see [Deploying](#deploying) below — the loop is the same either way, just run these commands against whichever database `DATABASE_URL` points at.)

2. **Refresh the data.** One command re-downloads all three FDA sources and reclassifies everything — takes a minute or two:
   ```bash
   npm run refresh:data
   ```
   This is safe to run anytime, as often as you like — every pipeline upserts on a natural key, so re-running never creates duplicates, and a bad/unreachable source for one step doesn't corrupt what's already loaded.

3. **Run patent-term enrichment.** This is the one step that's slow — USPTO allows one request at a time, so a full pass over every un-enriched patent takes on the order of an hour or two, not minutes:
   ```bash
   npm run enrich:pta
   ```
   It's fully resumable: stop it (Ctrl-C, closing the terminal, a restart) at any point and re-run the same command — already-enriched patents are skipped automatically, nothing is re-queried or re-billed. For a long-running production use, run it under whatever process supervisor you're already using (`pm2`, a systemd unit, a scheduled task on the deploy platform) rather than a bare foreground terminal.

4. **Watch it happen.** Sign in as an Analyst and open **`/data`** — shows when each source was last refreshed and what it loaded, plus live enrichment progress (overall and per-source), refreshing itself every 20 seconds while the tab is open. No terminal or database access needed; this is the page to bookmark and leave open during a long enrichment run.

There's deliberately no "click a button to start ingestion" control on that page — these are commands you run, not background jobs a web request kicks off, since a multi-hour process doesn't fit a normal request/response cycle (and would silently fail on most hosting platforms' request timeouts). `/data` is purely for watching; the commands above are for doing.

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
npm run ingest:purple-book            # download + load the current FDA Purple Book (product CSV + patent-list HTML)
npm run ingest:purple-book -- --url <csv-url>          # load from an explicit monthly file instead
npm run ingest:purple-book -- --skip-patent-list       # product data only, skip the HTML scrape
npm run ingest:paragraph-iv           # scrape FDA's page + load the current Paragraph IV Certifications List PDF
npm run ingest:paragraph-iv -- --url <pdf-url>         # load from an explicit PDF URL instead
npm run refresh:data                  # all three ingests + classification, in order, in one command
npm run enrich:pta                    # enrich all unenriched patents with USPTO PTA data (both sources)
npm run enrich:pta -- --limit 20      # sample run: next 20 patents only
npm run classify:drugs                # backfill modality/drugClass for existing drugs + biologics
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
- `Patent` and `Exclusivity` also have hand-added `CHECK` constraints now
  (exactly one of `drugId`/`biologicProductId`), plus hand-added plain
  `@@unique` indexes on the biologic side (`prisma/migrations/20260814180000_add_purple_book_biologics`)
  — same "not expressible in `schema.prisma` alone, re-add if regenerated
  from scratch" caveat as `IngestionRecord`'s. If you're tempted to add a
  compound unique index spanning *both* nullable FK columns together to
  "cover both cases in one index," don't — see the "Extending to a second
  product type" subsection of Data model for why that silently enforces
  nothing.
- **Any date-only value parsed via a plain `new Date(someString)` where
  `someString` has no explicit timezone is a real, live bug risk** — it
  resolves in whatever timezone the server happens to run in, not UTC. Two
  real instances of this were found and fixed in the Purple Book pipeline
  (see that section) purely by manually spot-checking a live API response
  against a real drug; neither was caught by an isolated unit check run in
  the same timezone the bug depended on. Always re-anchor via
  `new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))` (or
  parse the calendar fields directly, as the `D-Mon-YY` branch of
  `parsePurpleBookDate` already does) rather than trusting a locale-format
  date string's parsed instant directly.
- **Fetching FDA's Purple Book (either the CSV or the patent-list HTML)
  requires a browser-like `User-Agent` header** — a bare `fetch`/`curl`
  gets silently blocked by FDA's WAF, which returns a `200` "FDA Apology"
  HTML page rather than an error status. Both ingestion functions already
  check the response body for that page and throw explicitly rather than
  treating a apology-page `200` as success; keep that check if you touch
  the fetch logic. Orange Book's own `fda.gov/media/...` URL does not need
  this — it's a different subdomain with no such WAF rule observed.
