'use client';

import { motion } from 'framer-motion';
import { PageHeader } from '../PageHeader';

/**
 * Bounty Hunter — local league dashboard (rosters, weekly bounties, standings
 * and poster exports). The dashboard is a self-contained static app served
 * from /apps/bounty-hunter/; its live data lives in localStorage and a local
 * backup is written by the /api/publish route (see app/api/publish/route.ts).
 */
export function BountyHunterPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  return (
    <motion.div
      key="bounty-hunter-page"
      className="fixed inset-0 bg-black text-white flex flex-col z-[50]"
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <PageHeader
        title="Bounty Hunter"
        onNavigateHome={onNavigateHome}
        accent="orange"
        right={
          <span className="font-mono text-[9px] uppercase tracking-widest text-white/30">
            Local · Saves stay on this computer
          </span>
        }
      />

      <div className="flex-1 min-h-0 relative">
        <iframe
          src="/apps/bounty-hunter/index.html"
          title="Bounty Hunter league dashboard"
          className="absolute inset-0 w-full h-full border-0 bg-black"
          allow="clipboard-write"
        />
      </div>
    </motion.div>
  );
}