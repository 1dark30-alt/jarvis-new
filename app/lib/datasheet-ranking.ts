/** Prefer official / manufacturer-class domains over random mirrors. */
export const TRUSTED_DOMAIN_SUFFIXES = [
  'raspberrypi.com',
  'espressif.com',
  'st.com',
  'ti.com',
  'microchip.com',
  'analog.com',
  'infineon.com',
  'nvidia.com',
  'arduino.cc',
  'revrobotics.com',
  'docs.revrobotics.com',
];

/** Domains to heavily deprioritize (aggregation / mirror noise). */
const LOW_TRUST_HOST_SUBSTRINGS = [
  'scribd.com',
  'academia.edu',
  'slideshare.net',
  'pdfcookie.com',
  'pdfslide.net',
  'zdoc.tips',
  'idoc.pub',
  'vdocument.in',
  'fliphtml5.com',
  'dokumen.tips',
  'coursehero.com',
  'chegg.com',
];

const DOC_KEYWORDS =
  /\b(datasheet|data\s*sheet|product\s*brief|reference\s*manual|technical\s*reference|user\s*manual|pinout|hardware\s*reference)\b/i;

type MfrHint = { pattern: RegExp; sites: string[] };

const MANUFACTURER_HINTS: MfrHint[] = [
  { pattern: /raspberry|bcm2712|cm\d|pi\s*pico|compute\s*module/i, sites: ['raspberrypi.com'] },
  { pattern: /esp[- ]?32|esp[- ]?8266|espressif|wroom|wrover/i, sites: ['espressif.com'] },
  { pattern: /arduino|giga\s*r1|uno\s*r4/i, sites: ['arduino.cc'] },
  { pattern: /stm32|stm8|stmicro|(^|\s)stm\d/i, sites: ['st.com'] },
  { pattern: /msp430|tiva|cc\d{4}|sitara|(\s|^)ti\s|texas\s*instruments/i, sites: ['ti.com'] },
  { pattern: /microchip|pic32|dspic|atmega|attiny|^pic\d/i, sites: ['microchip.com'] },
  { pattern: /infineon|xmc|aurix|traveo/i, sites: ['infineon.com'] },
  { pattern: /\bad\d{3,5}\b|linear\s*tech|lt\d{4}/i, sites: ['analog.com'] },
  { pattern: /jetson|nvidia|tegra|cuda/i, sites: ['nvidia.com'] },
  {
    pattern: /spark\s*flex|rev\s*robotics|rev\s*hub|ultraplanetary|^neo\s*\d/i,
    sites: ['revrobotics.com', 'docs.revrobotics.com'],
  },
];

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isLikelyPdfUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.pdf') || /\.pdf(?:$|[?#])/i.test(path);
  } catch {
    return false;
  }
}

function hostMatchesTrusted(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return TRUSTED_DOMAIN_SUFFIXES.some((t) => h === t || h.endsWith('.' + t));
}

function isManufacturerHintDomain(host: string, hinted: Set<string>): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const hint of hinted) {
    const norm = hint.toLowerCase().replace(/^www\./, '');
    if (h === norm || h.endsWith('.' + norm)) return true;
  }
  return false;
}

export function manufacturerHostsForPart(partName: string): Set<string> {
  const set = new Set<string>();
  const q = partName.trim();
  if (!q) return set;
  for (const hint of MANUFACTURER_HINTS) {
    if (hint.pattern.test(q)) {
      hint.sites.forEach((s) => set.add(s.toLowerCase().replace(/^www\./, '')));
    }
  }
  return set;
}

function isLowTrustHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOW_TRUST_HOST_SUBSTRINGS.some((s) => h.includes(s));
}

function tokenizePartName(part: string): string[] {
  return part
    .toLowerCase()
    .replace(/[^\w\s.-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Build prioritized DuckDuckGo queries: manufacturer site: searches first, then broad PDF searches.
 */
export function buildDatasheetQueries(partName: string): string[] {
  const q = partName.trim();
  if (!q) return [];

  const hintedSites = new Set<string>();
  for (const hint of MANUFACTURER_HINTS) {
    if (hint.pattern.test(q)) {
      hint.sites.forEach((s) => hintedSites.add(s));
    }
  }

  const queries: string[] = [];

  for (const site of hintedSites) {
    queries.push(`site:${site} ${q} datasheet filetype:pdf`);
    queries.push(`site:${site} ${q} product brief filetype:pdf`);
    queries.push(`site:${site} ${q} documentation filetype:pdf`);
  }

  queries.push(`${q} datasheet filetype:pdf`);
  queries.push(`${q} official datasheet pdf`);
  queries.push(`"${q}" reference manual filetype:pdf`);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const query of queries) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

export interface RankedPdfCandidate {
  url: string;
  title: string;
  snippet: string;
  score: number;
  reasons: string[];
}

export function rankPdfCandidate(
  row: { title: string; url: string; snippet: string },
  partName: string,
  manufacturerHosts: Set<string>
): RankedPdfCandidate {
  const { title, url, snippet } = row;
  const reasons: string[] = [];
  let score = 0;

  const host = hostnameOf(url);
  const blob = `${title} ${snippet} ${url}`.toLowerCase();
  const tokens = tokenizePartName(partName);

  if (!isLikelyPdfUrl(url)) {
    score -= 200;
    reasons.push('not-a-direct-pdf-url');
  } else {
    score += 100;
    reasons.push('pdf-url');
  }

  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') {
      score -= 25;
      reasons.push('not-https');
    }
  } catch {
    score -= 300;
    reasons.push('invalid-url');
  }

  if (isManufacturerHintDomain(host, manufacturerHosts)) {
    score += 90;
    reasons.push('manufacturer-domain-for-part');
  } else if (hostMatchesTrusted(host)) {
    score += 55;
    reasons.push('trusted-oem-domain');
  }

  if (isLowTrustHost(host)) {
    score -= 120;
    reasons.push('mirror-or-aggregator');
  }

  let tokenHits = 0;
  for (const t of tokens) {
    if (t.length < 3 && !/^\d+[a-z]?$/i.test(t)) continue;
    if (blob.includes(t)) tokenHits++;
  }
  if (tokens.length > 0) {
    const ratio = tokenHits / tokens.length;
    const pts = Math.round(45 * ratio);
    score += pts;
    if (pts > 0) reasons.push(`part-name-match:${tokenHits}/${tokens.length}`);
  }

  if (DOC_KEYWORDS.test(title) || DOC_KEYWORDS.test(snippet)) {
    score += 28;
    reasons.push('doc-keyword-in-title-or-snippet');
  }

  if (/datasheet/i.test(title)) {
    score += 12;
    reasons.push('datasheet-in-title');
  }

  return { url, title, snippet, score, reasons };
}

export function pickBestPdf(candidates: RankedPdfCandidate[]): RankedPdfCandidate | null {
  const pdfs = candidates.filter((c) => isLikelyPdfUrl(c.url));
  if (pdfs.length === 0) return null;
  return [...pdfs].sort((a, b) => b.score - a.score)[0];
}
