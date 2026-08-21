"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { ProductPicker, type PickedProduct } from "./ProductPicker";
import {
  previewPatentLookupAction,
  previewGenericChallengeMatchAction,
  previewDocketLookupAction,
  submitManualPatentAction,
  submitManualExclusivityAction,
  submitManualGenericChallengeAction,
  submitManualLitigationCaseAction,
} from "@/app/data/actions";

const inputClass =
  "w-full rounded-md border border-paper-300 bg-paper-50 px-2 py-1.5 text-sm text-paper-900 focus:border-statute-500 focus:ring-1 focus:ring-statute-500 focus:outline-none dark:border-paper-700 dark:bg-paper-900 dark:text-paper-100";
const labelClass = "text-xs font-medium text-paper-600 dark:text-paper-400";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function ResultBanner({ message, tone }: { message: string; tone: "success" | "error" }) {
  return (
    <p
      className={clsx(
        "rounded-md px-2.5 py-1.5 text-xs",
        tone === "success"
          ? "bg-statute-50 text-statute-700 dark:bg-statute-500/10 dark:text-statute-400"
          : "bg-rust-50 text-rust-700 dark:bg-rust-500/10 dark:text-rust-400",
      )}
    >
      {message}
    </p>
  );
}

// ---- Patent -----------------------------------------------------------

function PatentForm() {
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [patentNumber, setPatentNumber] = useState("");
  const [coversDrugSubstance, setCoversDrugSubstance] = useState(false);
  const [coversDrugProduct, setCoversDrugProduct] = useState(false);
  const [useCode, setUseCode] = useState("");
  const [filingDate, setFilingDate] = useState("");
  const [nominalExpiryDate, setNominalExpiryDate] = useState("");
  const [effectiveExpiryDate, setEffectiveExpiryDate] = useState("");
  const [expiryAdjustmentDays, setExpiryAdjustmentDays] = useState("");
  const [submittedDate, setSubmittedDate] = useState("");
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function autoFetchPta() {
    if (!patentNumber.trim()) {
      setLookupMessage("Enter a patent number first.");
      return;
    }
    setLookupMessage("Looking up…");
    startTransition(async () => {
      const preview = await previewPatentLookupAction(patentNumber.trim());
      if (preview.status === "error") {
        setLookupMessage(preview.errorMessage ?? "Lookup failed.");
        return;
      }
      if (preview.status === "not_found") {
        setLookupMessage("Not found in USPTO ODP (pre-2001 filing, or not in the dataset) — enter dates by hand.");
        return;
      }
      if (preview.filingDate) setFilingDate(preview.filingDate);
      if (preview.expiryAdjustmentDays != null) setExpiryAdjustmentDays(String(preview.expiryAdjustmentDays));
      if (preview.isStandardPatentNumber && preview.nominalExpiryDate && preview.effectiveExpiryDate) {
        setNominalExpiryDate(preview.nominalExpiryDate);
        setEffectiveExpiryDate(preview.effectiveExpiryDate);
        setLookupMessage(`Found — filed ${preview.filingDate}, ${preview.expiryAdjustmentDays}d PTA. Dates prefilled below (still editable).`);
      } else {
        setLookupMessage(
          `Found — filed ${preview.filingDate}, ${preview.expiryAdjustmentDays}d PTA. Non-standard (reissue) patent number: no statutory baseline to compute — enter nominal expiry by hand, then add ${preview.expiryAdjustmentDays}d yourself if you want the PTA-adjusted effective date.`,
        );
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) {
      setResult({ tone: "error", message: "Pick a product first." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await submitManualPatentAction({
        productId: product.id,
        productSource: product.source,
        patentNumber: patentNumber.trim(),
        coversDrugSubstance,
        coversDrugProduct,
        useCode,
        filingDate: filingDate || null,
        nominalExpiryDate,
        effectiveExpiryDate,
        expiryAdjustmentDays: expiryAdjustmentDays ? Number(expiryAdjustmentDays) : null,
        submittedDate: submittedDate || null,
      });
      if (res.ok) {
        setResult({ tone: "success", message: "Patent saved." });
        router.refresh();
      } else {
        setResult({ tone: "error", message: res.message });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label="Product">
        <ProductPicker onSelect={setProduct} selected={product} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Patent number">
            <input value={patentNumber} onChange={(e) => setPatentNumber(e.target.value)} required className={inputClass} />
          </Field>
        </div>
        <button
          type="button"
          onClick={autoFetchPta}
          disabled={isPending}
          className="rounded-md border border-paper-300 px-2 py-1.5 text-xs font-medium text-paper-700 hover:bg-paper-100 disabled:opacity-50 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900"
        >
          Auto-fetch USPTO PTA data
        </button>
      </div>
      {lookupMessage && <p className="text-xs text-paper-500 dark:text-paper-400">{lookupMessage}</p>}
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-xs text-paper-700 dark:text-paper-300">
          <input type="checkbox" checked={coversDrugSubstance} onChange={(e) => setCoversDrugSubstance(e.target.checked)} className="rounded border-paper-300 dark:border-paper-700" />
          Covers drug substance
        </label>
        <label className="flex items-center gap-1.5 text-xs text-paper-700 dark:text-paper-300">
          <input type="checkbox" checked={coversDrugProduct} onChange={(e) => setCoversDrugProduct(e.target.checked)} className="rounded border-paper-300 dark:border-paper-700" />
          Covers drug product
        </label>
      </div>
      <Field label="Use code (optional)">
        <input value={useCode} onChange={(e) => setUseCode(e.target.value)} placeholder="e.g. U-1839" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Filing date (optional)">
          <input type="date" value={filingDate} onChange={(e) => setFilingDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Submitted date (optional)">
          <input type="date" value={submittedDate} onChange={(e) => setSubmittedDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Nominal expiry date">
          <input type="date" value={nominalExpiryDate} onChange={(e) => setNominalExpiryDate(e.target.value)} required className={inputClass} />
        </Field>
        <Field label="Effective expiry date">
          <input type="date" value={effectiveExpiryDate} onChange={(e) => setEffectiveExpiryDate(e.target.value)} required className={inputClass} />
        </Field>
        <Field label="PTA adjustment days (optional)">
          <input type="number" value={expiryAdjustmentDays} onChange={(e) => setExpiryAdjustmentDays(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <button type="submit" disabled={isPending} className="w-fit rounded-md bg-paper-900 px-3 py-1.5 text-xs font-medium text-paper-50 hover:bg-paper-800 disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-200">
        {isPending ? "Saving…" : "Save patent"}
      </button>
      {result && <ResultBanner {...result} />}
    </form>
  );
}

// ---- Exclusivity --------------------------------------------------------

function ExclusivityForm() {
  const router = useRouter();
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [grantedDate, setGrantedDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) {
      setResult({ tone: "error", message: "Pick a product first." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await submitManualExclusivityAction({
        productId: product.id,
        productSource: product.source,
        code: code.trim(),
        description: description.trim() || null,
        grantedDate: grantedDate || null,
        expirationDate,
      });
      if (res.ok) {
        setResult({ tone: "success", message: "Exclusivity saved." });
        router.refresh();
      } else {
        setResult({ tone: "error", message: res.message });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label="Product">
        <ProductPicker onSelect={setProduct} selected={product} />
      </Field>
      <Field label="Exclusivity code">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NCE, ODE-225, PED" required className={inputClass} />
      </Field>
      <Field label="Description (optional)">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Granted date (optional)">
          <input type="date" value={grantedDate} onChange={(e) => setGrantedDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Expiration date">
          <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} required className={inputClass} />
        </Field>
      </div>
      <button type="submit" disabled={isPending} className="w-fit rounded-md bg-paper-900 px-3 py-1.5 text-xs font-medium text-paper-50 hover:bg-paper-800 disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-200">
        {isPending ? "Saving…" : "Save exclusivity"}
      </button>
      {result && <ResultBanner {...result} />}
    </form>
  );
}

// ---- Generic Challenge ----------------------------------------------------

function GenericChallengeForm() {
  const router = useRouter();
  const [activeIngredient, setActiveIngredient] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [strength, setStrength] = useState("");
  const [rldName, setRldName] = useState("");
  const [rldNdaNumber, setRldNdaNumber] = useState("");
  const [submissionDateType, setSubmissionDateType] = useState<"EXACT_DATE" | "PRE_MMA" | "RECEIVED_PRIOR_TO">("EXACT_DATE");
  const [submissionDate, setSubmissionDate] = useState("");
  const [matchState, setMatchState] = useState<{ reason: string; candidates: { id: string; brandName: string; dosageForm: string }[] } | null>(null);
  const [confirmedDrugId, setConfirmedDrugId] = useState<string | null>(null);
  const [manualPick, setManualPick] = useState<PickedProduct | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function checkMatch() {
    setMatchState(null);
    setConfirmedDrugId(null);
    startTransition(async () => {
      const preview = await previewGenericChallengeMatchAction(rldNdaNumber.trim() || null, dosageForm.trim());
      setMatchState({ reason: preview.match.reason, candidates: preview.candidateDrugs });
      if (preview.match.reason === "matched" && preview.candidateDrugs.length === 1) {
        setConfirmedDrugId(preview.candidateDrugs[0].id);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await submitManualGenericChallengeAction({
        activeIngredient: activeIngredient.trim(),
        dosageForm: dosageForm.trim(),
        strength: strength.trim(),
        rldName: rldName.trim(),
        rldNdaNumber: rldNdaNumber.trim() || null,
        submissionDateType,
        submissionDate: submissionDateType === "PRE_MMA" ? null : submissionDate || null,
        confirmedDrugId: confirmedDrugId ?? manualPick?.id ?? null,
      });
      if (res.ok) {
        setResult({ tone: "success", message: confirmedDrugId || manualPick ? "Generic challenge saved and linked." : "Generic challenge saved as unlinked — link it later from the list below." });
        router.refresh();
      } else {
        setResult({ tone: "error", message: res.message });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Active ingredient">
          <input value={activeIngredient} onChange={(e) => setActiveIngredient(e.target.value)} required className={inputClass} />
        </Field>
        <Field label="Dosage form">
          <input value={dosageForm} onChange={(e) => setDosageForm(e.target.value)} required className={inputClass} />
        </Field>
        <Field label="Strength">
          <input value={strength} onChange={(e) => setStrength(e.target.value)} required className={inputClass} />
        </Field>
        <Field label="RLD / brand name">
          <input value={rldName} onChange={(e) => setRldName(e.target.value)} required className={inputClass} />
        </Field>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="RLD/NDA number (optional — used to find the product)">
            <input value={rldNdaNumber} onChange={(e) => setRldNdaNumber(e.target.value)} placeholder="e.g. NDA021986" className={inputClass} />
          </Field>
        </div>
        <button type="button" onClick={checkMatch} disabled={isPending || !dosageForm.trim()} className="rounded-md border border-paper-300 px-2 py-1.5 text-xs font-medium text-paper-700 hover:bg-paper-100 disabled:opacity-50 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900">
          Check match
        </button>
      </div>
      {matchState && (
        <div className="rounded-md border border-paper-200 p-2.5 text-xs dark:border-paper-800">
          {matchState.reason === "matched" && matchState.candidates.length === 1 && (
            <p className="text-statute-700 dark:text-statute-400">Matched to: {matchState.candidates[0].brandName} ({matchState.candidates[0].dosageForm})</p>
          )}
          {matchState.reason === "matched" && matchState.candidates.length > 1 && (
            <div>
              <p className="mb-1 text-paper-600 dark:text-paper-400">Ambiguous — {matchState.candidates.length} products match this NDA. Pick one:</p>
              {matchState.candidates.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 py-0.5">
                  <input type="radio" name="ga-candidate" checked={confirmedDrugId === c.id} onChange={() => setConfirmedDrugId(c.id)} />
                  {c.brandName} ({c.dosageForm})
                </label>
              ))}
            </div>
          )}
          {(matchState.reason === "no_nda_number" || matchState.reason === "nda_not_found" || matchState.candidates.length === 0) && (
            <div>
              <p className="mb-1 text-paper-500 dark:text-paper-400">No automatic match — search manually, or save unlinked and link it later.</p>
              <ProductPicker onSelect={setManualPick} selected={manualPick} />
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Submission date type">
          <select value={submissionDateType} onChange={(e) => setSubmissionDateType(e.target.value as typeof submissionDateType)} className={inputClass}>
            <option value="EXACT_DATE">Exact date</option>
            <option value="PRE_MMA">Pre-MMA (pre-2003)</option>
            <option value="RECEIVED_PRIOR_TO">Received prior to</option>
          </select>
        </Field>
        {submissionDateType !== "PRE_MMA" && (
          <Field label="Submission date">
            <input type="date" value={submissionDate} onChange={(e) => setSubmissionDate(e.target.value)} className={inputClass} />
          </Field>
        )}
      </div>
      <button type="submit" disabled={isPending} className="w-fit rounded-md bg-paper-900 px-3 py-1.5 text-xs font-medium text-paper-50 hover:bg-paper-800 disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-200">
        {isPending ? "Saving…" : "Save generic challenge"}
      </button>
      {result && <ResultBanner {...result} />}
    </form>
  );
}

// ---- Litigation Case ------------------------------------------------------

type PartyMatch = { company: { id: string; name: string } | null; matchType: "exact" | "fuzzy" | "none" };

function LitigationCaseForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"known" | "lookup">("lookup");

  // "I know the product" mode
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [plaintiffNameRaw, setPlaintiffNameRaw] = useState("");
  const [defendantNameRaw, setDefendantNameRaw] = useState("");
  const [docketNumber, setDocketNumber] = useState("");
  const [court, setCourt] = useState<"DE" | "NJ">("DE");
  const [filingDate, setFilingDate] = useState("");
  const [dateTerminated, setDateTerminated] = useState("");
  const [judge, setJudge] = useState("");
  const [natureOfSuit, setNatureOfSuit] = useState("");

  // "Look up by docket number" mode
  const [lookupDocketNumber, setLookupDocketNumber] = useState("");
  const [preview, setPreview] = useState<{
    status: string;
    errorMessage?: string;
    hit?: { externalDocketId: number; docketNumber: string; court: "DE" | "NJ"; filingDate: string | null; dateTerminated: string | null; judge: string | null; natureOfSuit: string | null; cause: string | null };
    plaintiffNameRaw?: string;
    defendantNameRaw?: string;
    plaintiffMatch?: PartyMatch;
    defendantMatch?: PartyMatch;
    candidateDrugs?: { id: string; brandName: string }[];
    score?: { tier: "HIGH" | "MEDIUM" | "LOW" | "NONE"; note: string };
  } | null>(null);
  const [confirmedDrugId, setConfirmedDrugId] = useState<string | null>(null);
  const [manualPick, setManualPick] = useState<PickedProduct | null>(null);

  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function doLookup() {
    setPreview(null);
    setConfirmedDrugId(null);
    startTransition(async () => {
      const p = await previewDocketLookupAction(lookupDocketNumber.trim());
      setPreview(p);
      if (p.score?.tier === "HIGH" && p.candidateDrugs?.length === 1) {
        setConfirmedDrugId(p.candidateDrugs[0].id);
      }
    });
  }

  function onSubmitKnown(e: React.FormEvent) {
    e.preventDefault();
    if (!product) {
      setResult({ tone: "error", message: "Pick a product first." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const res = await submitManualLitigationCaseAction({
        plaintiffNameRaw: plaintiffNameRaw.trim(),
        defendantNameRaw: defendantNameRaw.trim(),
        plaintiffCompanyId: null,
        defendantCompanyId: null,
        confirmedDrugId: product.id,
        matchConfidence: "HIGH",
        matchNote: "Product selected directly by the analyst — no automated matching needed.",
        docket: {
          docketNumber: docketNumber.trim(),
          court,
          externalDocketId: null,
          filingDate: filingDate || null,
          dateTerminated: dateTerminated || null,
          judge: judge.trim() || null,
          natureOfSuit: natureOfSuit.trim() || null,
        },
      });
      if (res.ok) {
        setResult({ tone: "success", message: "Litigation case saved." });
        router.refresh();
      } else {
        setResult({ tone: "error", message: res.message });
      }
    });
  }

  function onSubmitLookup(e: React.FormEvent) {
    e.preventDefault();
    const hit = preview?.hit;
    if (!hit) return;
    setResult(null);
    startTransition(async () => {
      const res = await submitManualLitigationCaseAction({
        plaintiffNameRaw: preview.plaintiffNameRaw ?? "",
        defendantNameRaw: preview.defendantNameRaw ?? "",
        plaintiffCompanyId: preview.plaintiffMatch?.company?.id ?? null,
        defendantCompanyId: preview.defendantMatch?.company?.id ?? null,
        confirmedDrugId: confirmedDrugId ?? manualPick?.id ?? null,
        matchConfidence: preview.score?.tier ?? "NONE",
        matchNote: preview.score?.note ?? null,
        docket: {
          docketNumber: hit.docketNumber,
          court: hit.court,
          externalDocketId: hit.externalDocketId,
          filingDate: hit.filingDate,
          dateTerminated: hit.dateTerminated,
          judge: hit.judge,
          natureOfSuit: hit.natureOfSuit,
        },
      });
      if (res.ok) {
        setResult({ tone: "success", message: confirmedDrugId || manualPick ? "Litigation case saved and linked." : "Litigation case saved as unlinked — link it later from the list below." });
        router.refresh();
      } else {
        setResult({ tone: "error", message: res.message });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("lookup")} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", mode === "lookup" ? "bg-paper-900 text-paper-50 dark:bg-paper-100 dark:text-paper-900" : "border border-paper-300 text-paper-700 dark:border-paper-700 dark:text-paper-300")}>
          Look up by docket number
        </button>
        <button type="button" onClick={() => setMode("known")} className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", mode === "known" ? "bg-paper-900 text-paper-50 dark:bg-paper-100 dark:text-paper-900" : "border border-paper-300 text-paper-700 dark:border-paper-700 dark:text-paper-300")}>
          I know the product
        </button>
      </div>

      {mode === "lookup" ? (
        <form onSubmit={onSubmitLookup} className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Docket number (District of Delaware or New Jersey)">
                <input value={lookupDocketNumber} onChange={(e) => setLookupDocketNumber(e.target.value)} placeholder="e.g. 3:19-cv-01028" className={inputClass} />
              </Field>
            </div>
            <button type="button" onClick={doLookup} disabled={isPending || !lookupDocketNumber.trim()} className="rounded-md border border-paper-300 px-2 py-1.5 text-xs font-medium text-paper-700 hover:bg-paper-100 disabled:opacity-50 dark:border-paper-700 dark:text-paper-300 dark:hover:bg-paper-900">
              Look up
            </button>
          </div>

          {preview?.status === "error" && <ResultBanner tone="error" message={preview.errorMessage ?? "Lookup failed."} />}
          {preview?.status === "not_found" && <ResultBanner tone="error" message="No docket found for that number in D. Del. / D.N.J." />}
          {preview?.status === "found" && preview.hit && (
            <div className="rounded-md border border-paper-200 p-3 text-xs dark:border-paper-800">
              <p className="font-medium text-paper-900 dark:text-paper-50">
                {preview.plaintiffNameRaw} v. {preview.defendantNameRaw}
              </p>
              <p className="mt-1 text-paper-500 dark:text-paper-400">
                {preview.hit.court === "DE" ? "D. Del." : "D.N.J."} · {preview.hit.docketNumber}
                {preview.hit.filingDate && <> · filed {preview.hit.filingDate}</>}
                {preview.hit.judge && <> · Judge {preview.hit.judge}</>}
              </p>
              <p className="mt-2">
                Plaintiff: {preview.plaintiffMatch?.company ? `matched (${preview.plaintiffMatch.matchType}) — ${preview.plaintiffMatch.company.name}` : "no match"}
                <br />
                Defendant: {preview.defendantMatch?.company ? `matched (${preview.defendantMatch.matchType}) — ${preview.defendantMatch.company.name}` : "no match"}
              </p>
              <p className="mt-2 font-medium text-paper-700 dark:text-paper-300">Match confidence: {preview.score?.tier}</p>
              <p className="text-paper-500 dark:text-paper-400">{preview.score?.note}</p>

              {preview.candidateDrugs && preview.candidateDrugs.length > 0 ? (
                <div className="mt-2">
                  <p className="mb-1 text-paper-600 dark:text-paper-400">Candidate product(s) — confirm before saving:</p>
                  {preview.candidateDrugs.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 py-0.5">
                      <input type="radio" name="lit-candidate" checked={confirmedDrugId === d.id} onChange={() => setConfirmedDrugId(d.id)} />
                      {d.brandName}
                    </label>
                  ))}
                </div>
              ) : (
                <div className="mt-2">
                  <p className="mb-1 text-paper-500 dark:text-paper-400">No candidate product found automatically — search manually, or save unlinked.</p>
                  <ProductPicker onSelect={setManualPick} selected={manualPick} />
                </div>
              )}

              <button type="submit" disabled={isPending} className="mt-3 w-fit rounded-md bg-paper-900 px-3 py-1.5 text-xs font-medium text-paper-50 hover:bg-paper-800 disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-200">
                {isPending ? "Saving…" : "Save litigation case"}
              </button>
            </div>
          )}
          {result && <ResultBanner {...result} />}
        </form>
      ) : (
        <form onSubmit={onSubmitKnown} className="flex flex-col gap-3">
          <Field label="Product">
            <ProductPicker onSelect={setProduct} selected={product} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plaintiff">
              <input value={plaintiffNameRaw} onChange={(e) => setPlaintiffNameRaw(e.target.value)} required className={inputClass} />
            </Field>
            <Field label="Defendant">
              <input value={defendantNameRaw} onChange={(e) => setDefendantNameRaw(e.target.value)} required className={inputClass} />
            </Field>
            <Field label="Docket number">
              <input value={docketNumber} onChange={(e) => setDocketNumber(e.target.value)} required className={inputClass} />
            </Field>
            <Field label="Court">
              <select value={court} onChange={(e) => setCourt(e.target.value as "DE" | "NJ")} className={inputClass}>
                <option value="DE">District of Delaware</option>
                <option value="NJ">District of New Jersey</option>
              </select>
            </Field>
            <Field label="Filing date (optional)">
              <input type="date" value={filingDate} onChange={(e) => setFilingDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Terminated date (optional)">
              <input type="date" value={dateTerminated} onChange={(e) => setDateTerminated(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Judge (optional)">
              <input value={judge} onChange={(e) => setJudge(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Nature of suit (optional)">
              <input value={natureOfSuit} onChange={(e) => setNatureOfSuit(e.target.value)} placeholder="e.g. 830 Patent" className={inputClass} />
            </Field>
          </div>
          <button type="submit" disabled={isPending} className="w-fit rounded-md bg-paper-900 px-3 py-1.5 text-xs font-medium text-paper-50 hover:bg-paper-800 disabled:opacity-50 dark:bg-paper-100 dark:text-paper-900 dark:hover:bg-paper-200">
            {isPending ? "Saving…" : "Save litigation case"}
          </button>
          {result && <ResultBanner {...result} />}
        </form>
      )}
    </div>
  );
}

// ---- Panel ---------------------------------------------------------------

type EntityType = "patent" | "exclusivity" | "generic_challenge" | "litigation_case";

const TABS: { key: EntityType; label: string }[] = [
  { key: "litigation_case", label: "Litigation" },
  { key: "generic_challenge", label: "Generic challenge" },
  { key: "patent", label: "Patent" },
  { key: "exclusivity", label: "Exclusivity" },
];

export function ManualEntryPanel() {
  const [entityType, setEntityType] = useState<EntityType>("litigation_case");

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold text-paper-900 dark:text-paper-50">Add data manually</h2>
      <p className="mb-3 text-xs text-paper-500 dark:text-paper-400">
        For filling a specific gap the automated pipelines missed — e.g. litigation not yet in RECAP/PACER. Every
        entry is tagged as manually entered, distinct from pipeline-sourced data, and logged in the audit trail
        below.
      </p>
      <div className="mb-3 flex gap-2 border-b border-paper-200 dark:border-paper-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setEntityType(t.key)}
            className={clsx(
              "border-b-2 px-2 py-1.5 text-xs font-medium",
              entityType === t.key
                ? "border-statute-500 text-paper-900 dark:text-paper-50"
                : "border-transparent text-paper-500 hover:text-paper-700 dark:text-paper-400 dark:hover:text-paper-200",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-paper-200 bg-paper-100 p-4 dark:border-paper-800 dark:bg-paper-950">
        {entityType === "patent" && <PatentForm />}
        {entityType === "exclusivity" && <ExclusivityForm />}
        {entityType === "generic_challenge" && <GenericChallengeForm />}
        {entityType === "litigation_case" && <LitigationCaseForm />}
      </div>
    </section>
  );
}
