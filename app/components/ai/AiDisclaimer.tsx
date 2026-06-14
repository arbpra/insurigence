import { AI_DISCLAIMER } from '@/lib/ai/config';

/**
 * Canonical disclaimer banner shown with EVERY AI output across the app.
 * Encodes the client's requirement: "Guidance only. Final review required by
 * licensed agent." Every AI feature renders this so the framing is consistent
 * and can never be forgotten on a new screen.
 *
 * Presentational only (no state) — safe to render in server or client trees.
 */
export default function AiDisclaimer({
  text = AI_DISCLAIMER,
  className = '',
}: {
  /** Override the message if a feature needs more specific wording. */
  text?: string;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 ${className}`}
      data-testid="ai-disclaimer"
    >
      <span aria-hidden className="mt-0.5 font-bold">⚠</span>
      <span>{text}</span>
    </div>
  );
}
