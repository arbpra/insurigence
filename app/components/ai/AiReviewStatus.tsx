/**
 * Shows whether an AI output has been reviewed by a licensed agent yet.
 * Reads from the AiRun.reviewedAt / reviewedById trail added on Day 3.
 *
 * Presentational only — the actual "Approve" action is wired up per feature
 * (it needs a feature-specific endpoint), so this just reflects current state.
 */
export default function AiReviewStatus({
  reviewedAt,
  reviewerName,
  className = '',
}: {
  /** ISO string when an agent reviewed it, or null/undefined if not yet. */
  reviewedAt?: string | null;
  reviewerName?: string | null;
  className?: string;
}) {
  const reviewed = Boolean(reviewedAt);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        reviewed ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
      } ${className}`}
      data-testid="ai-review-status"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${reviewed ? 'bg-green-600' : 'bg-amber-500'}`} />
      {reviewed
        ? `Reviewed${reviewerName ? ` by ${reviewerName}` : ''}`
        : 'Awaiting agent review'}
    </span>
  );
}
