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
    "bg-statute-50 text-statute-700 ring-statute-600/20 dark:bg-statute-500/10 dark:text-statute-400 dark:ring-statute-500/20",
  DEFERRED: "bg-flag-50 text-flag-700 ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20",
  NON_FORFEITURE: "bg-ledger-50 text-ledger-700 ring-ledger-600/20 dark:bg-ledger-500/10 dark:text-ledger-400 dark:ring-ledger-500/20",
  EXTINGUISHED: "bg-paper-100 text-paper-600 ring-paper-500/20 dark:bg-paper-800 dark:text-paper-400 dark:ring-paper-600/30",
};

function StatusBadge({ status }: { status: Challenge["currentStatus"] }) {
  if (!status) {
    return (
      <span
        className="inline-flex items-center rounded-full bg-paper-100 px-2.5 py-1 text-xs font-medium text-paper-500 ring-1 ring-inset ring-paper-500/20 dark:bg-paper-800 dark:text-paper-400"
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
    <div className="rounded-lg border border-paper-200 p-4 dark:border-paper-800">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={challenge.currentStatus} />
        <span className="text-xs text-paper-500 dark:text-paper-400">
          First PIV submission: {submissionDateLabel(challenge)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {challenge.dateOfFirstCommercialMarketing && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400">Date of first commercial marketing</dt>
            <dd className="font-medium font-mono tabular-nums text-paper-900 dark:text-paper-50">
              {formatDate(challenge.dateOfFirstCommercialMarketing)}
            </dd>
          </div>
        )}
        {challenge.dateOfFirstApplicantApproval && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400">Date of first applicant ANDA approval</dt>
            <dd className="font-mono tabular-nums text-paper-700 dark:text-paper-300">{formatDate(challenge.dateOfFirstApplicantApproval)}</dd>
          </div>
        )}
        {challenge.potentialFirstApplicantAndaCount != null && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400">Potential first-applicant ANDAs</dt>
            <dd className="font-mono tabular-nums text-paper-700 dark:text-paper-300">{challenge.potentialFirstApplicantAndaCount}</dd>
          </div>
        )}
        {challenge.expirationOfLastQualifyingPatent && (
          <div>
            <dt className="text-xs text-paper-500 dark:text-paper-400" title="FDA's own figure — excludes pediatric exclusivity, reflects only patents with a Paragraph IV certification. Not a substitute for this drug's computed effective expiry above.">
              Expiration of last qualifying patent (reference only)
            </dt>
            <dd className="font-mono tabular-nums text-paper-700 dark:text-paper-300">{formatDate(challenge.expirationOfLastQualifyingPatent)}</dd>
          </div>
        )}
      </dl>

      {diverges && (
        <p className="mt-3 rounded-md bg-flag-50 px-3 py-2 text-xs font-medium text-flag-800 ring-1 ring-inset ring-flag-600/20 dark:bg-flag-500/10 dark:text-flag-400 dark:ring-flag-500/20">
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
      <h2 className="mb-2 text-sm font-semibold text-paper-900 dark:text-paper-50">
        Generic challenge <span className="font-normal text-paper-400">(FDA Paragraph IV Certifications List)</span>
      </h2>
      <div className="flex flex-col gap-3">
        {challenges.map((c) => (
          <ChallengeCard key={c.id} challenge={c} computedEstimateDate={computedEstimateDate} />
        ))}
      </div>
      <p className="mt-2 text-xs text-paper-400 dark:text-paper-600">
        FDA notes that its regulatory decisions are based on the underlying applications, not this published list —
        this list can lag or occasionally diverge from ground truth.
      </p>
    </section>
  );
}
