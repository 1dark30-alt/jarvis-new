'use client';

import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Wildcard Draw — offline APA wildcard team draw (eligibility preview,
 * animated spins and results board). The original plugin ships a single
 * self-contained HTML page; here it is served from /apps/wildcard-draw/.
 * Team list and cutoff persist in localStorage for this origin.
 */
export function WildcardDrawPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  return (
    <motion.div
      key="wildcard-draw-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Wildcard Draw"
        onNavigateHome={onNavigateHome}
        accent="cyan"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            Offline · Copy results before closing
          </span>
        }
      />

      <div className="flex-1 min-h-0 relative">
        <iframe
          src="/apps/wildcard-draw/index.html"
          title="Wildcard Draw"
          className="absolute inset-0 w-full h-full border-0 bg-black"
          allow="clipboard-write"
        />
      </div>
    </motion.div>
  );
}