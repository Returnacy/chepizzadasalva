import { ChevronRight } from 'lucide-react';
import { useHandoff } from './HandoffProvider';
import type { HandoffLink } from './handoff';

// The brand's optional way out to its other service (getHandoffLink). A quiet
// row under the customer's own content, not a banner: the loyalty card stays
// the page.
export function HandoffLinkCard({ link }: { link: HandoffLink }) {
  const { start } = useHandoff();
  return (
    <button
      type="button"
      onClick={() => start(link.target, 'card')}
      className="mt-8 flex w-full items-center gap-4 rounded-xl border border-gray-200/70 bg-white/90 px-5 py-4 text-left shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-blue))]"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-gray-800">{link.label}</span>
        {link.description && <span className="mt-0.5 block text-sm text-gray-600">{link.description}</span>}
      </span>
      <ChevronRight className="h-5 w-5 flex-none text-[var(--brand-accent)]" aria-hidden />
    </button>
  );
}
