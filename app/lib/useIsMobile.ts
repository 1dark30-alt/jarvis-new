'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true when the client is a touch/mobile device or the viewport is
 * narrower than 768 px. Safe to use in SSR — returns false until hydrated.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const narrow  = window.innerWidth < 768;
      const touch   = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const mobileUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      setIsMobile(narrow || touch || mobileUA);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return isMobile;
}
