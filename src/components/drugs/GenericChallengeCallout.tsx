import clsx from "clsx";
import type { DrugDetail } from "@/lib/drugs/schemas";
import { formatDate } from "@/lib/format";

type Challenge = DrugDetail["genericChallenges"][number];

const STATUS_LABELS: Record<NonNullable<Challenge["currentStatus"]>, string> = {
  ELIGIBLE: "Eligible",
  DEFERRED: "Deferred",
  NON_FORFEITURE: "Non-Forfeiture",
  EXTINGUISHED: "Extinguished",
};

const STATUS_STYLES: Record<NonNullable<Challenge["currentStatus"]>, string> = {
  ELIGIBLE:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
  DEFERRED: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20",
  NON_FORFEITURE: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20",
  EXTINGUISHED: "bg-zinc-100 text-zinc-600 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-600/30",
};

function StatusBadge({ status }: { status: Challenge["currentStatus"] }) {
  if (!status) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-500 ring-1 ring-inset ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-400"
        title="FDA hasn't made a 180-day exclusivity eligibility decision for this challenge yet"
      >
        No decision yet
      </span>
    );
  }
  return (
    <span className={clsx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function submissionDateLabel(c: Challenge): string {
  if (c.submissionDateType === "PRE_MMA") {
    return "Pre-MMA (pre-2003 filing — individual submission dates aren't tracked under the statutory scheme in effect at the time)";
  }
  if (c.submissionDateType === "RECEIVED_PRIOR_TO") {
    return c.submissionDate ? `Received prior to ${formatDate(c.submissionDate)}` : "Received prior to an unspecified date";
  }
  return c.submissionDate ? formatDate(c.submissionDate) : "Unknown";
}

function ChallengeCard({ challenge, computedEstimateDate }: { challenge: Challenge; computedEstimateDate: string | null }) {
  const diverges =
    challenge.dateOfFirstCommercialMarketing != null &&
    computedEstimateDate != null &&
    challenge.dateOfFirstCommercialMarketing < computedEstimateDate;

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={challenge.currentStatus} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          First PIV submission: {submissionDateLabel(challenge)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {challenge.dateOfFirstCommercialMarketing && (
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Date of first commercial marketing</dt>
            <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatDate(challenge.dateOfFirstCommercialMarketing)}
            </dd>
          </div>
        )}
        {challenge.dateOfFirstApplicantApproval && (
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Date of first applicant ANDA approval</dt>
            <dd className="tabular-nums text-zinc-700 dark:text-zinc-300">{formatDate(challenge.dateOfFirstApplicantApproval)}</dd>
          </div>
        )}
        {challenge.potentialFirstApplicantAndaCount != null && (
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">Potential first-applicant ANDAs</dt>
            <dd className="tabular-nums text-zinc-700 dark:text-zinc-300">{challenge.potentialFirstApplicantAndaCount}</dd>
          </div>
        )}
        {challenge.expirationOfLastQualifyingPatent && (
          <div>
            <dt className="text-xs text-zinc-500 dark:text-zinc-400" title="FDA's own figure — excludes pediatric exclusivity, reflects only patents with a Paragraph IV certification. Not a substitute for this drug's computed effective expiry above.">
              Expiration of last qualifying patent (reference only)
            </dt>
            <dd className="tabular-nums text-zinc-700 dark:text-zinc-300">{formatDate(challenge.expirationOfLastQualifyingPatent)}</dd>
          </div>
        )}
      </dl>

      {diverges && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
          Generic entry occurred before the computed expiry date — a generic began commercial marketing on{" "}
          {formatDate(challenge.dateOfFirstCommercialMarketing!)}, earlier than this drug&apos;s computed estimate above.
        </p>
      )}
    </div>
  );
}

export function GenericChallengeCallout({
  challenges,
  computedEstimateDate,
}: {
  challenges: DrugDetail["genericChallenges"];
  computedEstimateDate: string | null;
}) {
  if (challenges.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Generic challenge <span className="font-normal text-zinc-400">(FDA Paragraph IV Certifications List)</span>
      </h2>
      <div className="flex flex-col gap-3">
        {challenges.map((c) => (
          <ChallengeCard key={c.id} challenge={c} computedEstimateDate={computedEstimateDate} />
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
        FDA notes that its regulatory decisions are based on the underlying applications, not this published list —
        this list can lag or occasionally diverge from ground truth.
      </p>
    </section>
  );
}
