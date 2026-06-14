/**
 * Small inline tag marking a block of content as AI-generated. Lets agents (and
 * insureds, where shown) immediately tell AI-assisted text apart from
 * deterministic, rules-engine, or human-entered content.
 */
export default function AiAssistedBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ${className}`}
      data-testid="ai-assisted-badge"
    >
      <span aria-hidden>✦</span>
      AI-assisted
    </span>
  );
}
